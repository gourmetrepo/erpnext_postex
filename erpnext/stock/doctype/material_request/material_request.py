# Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
# License: GNU General Public License v3. See license.txt

# ERPNext - web based ERP (http://erpnext.com)
# For license information, please see license.txt


import json

import frappe
from frappe import _, msgprint
from frappe.model.mapper import get_mapped_doc
from frappe.query_builder.functions import Sum
from frappe.utils import cint, cstr, flt, get_link_to_form, getdate, new_line_sep, nowdate

from erpnext.buying.utils import check_on_hold_or_closed_status, validate_for_items
from erpnext.controllers.buying_controller import BuyingController
from erpnext.manufacturing.doctype.work_order.work_order import get_item_details
from erpnext.stock.doctype.item.item import get_item_defaults
from erpnext.stock.stock_balance import get_indented_qty, update_bin_qty

form_grid_templates = {"items": "templates/form_grid/material_request_grid.html"}


class MaterialRequest(BuyingController):
	def get_feed(self):
		return

	def check_if_already_pulled(self):
		pass

	def validate_qty_against_so(self):
		so_items = {}  # Format --> {'SO/00001': {'Item/001': 120, 'Item/002': 24}}
		for d in self.get("items"):
			if d.sales_order:
				if not d.sales_order in so_items:
					so_items[d.sales_order] = {d.item_code: flt(d.qty)}
				else:
					if not d.item_code in so_items[d.sales_order]:
						so_items[d.sales_order][d.item_code] = flt(d.qty)
					else:
						so_items[d.sales_order][d.item_code] += flt(d.qty)

		for so_no in so_items.keys():
			for item in so_items[so_no].keys():
				already_indented = frappe.db.sql(
					"""select sum(qty)
					from `tabMaterial Request Item`
					where item_code = %s and sales_order = %s and
					docstatus = 1 and parent != %s""",
					(item, so_no, self.name),
				)
				already_indented = already_indented and flt(already_indented[0][0]) or 0

				actual_so_qty = frappe.db.sql(
					"""select sum(stock_qty) from `tabSales Order Item`
					where parent = %s and item_code = %s and docstatus = 1""",
					(so_no, item),
				)
				actual_so_qty = actual_so_qty and flt(actual_so_qty[0][0]) or 0

				if actual_so_qty and (flt(so_items[so_no][item]) + already_indented > actual_so_qty):
					frappe.throw(
						_("Material Request of maximum {0} can be made for Item {1} against Sales Order {2}").format(
							actual_so_qty - already_indented, item, so_no
						)
					)

	def on_trash(self):
		if self.type == 'Pick & Pack' or self.type == 'Put Away Return':
			dns = ', '.join(f'"{i.against}"' for i in self.dn_mr_item)
			frappe.db.sql(f"""update `tabDelivery Note` set custom_dn_selected = 0 WHERE name in ({dns})""")
		elif self.type == 'Put Away GRN':
			se = ', '.join(f'"{i.against}"' for i in self.mr_se_item)
			frappe.db.sql(f"""UPDATE `tabStock Entry` set custom_se_selected = 0 WHERE name in ({se})""")
	
	def validate(self):
		super(MaterialRequest, self).validate()

		self.validate_schedule_date()
		self.check_for_on_hold_or_closed_status("Sales Order", "sales_order")
		self.validate_uom_is_integer("uom", "qty")
		self.validate_material_request_type()

		if not self.status:
			self.status = "Draft"

		from erpnext.controllers.status_updater import validate_status

		validate_status(
			self.status,
			[
				"Draft",
				"Submitted",
				"Stopped",
				"Cancelled",
				"Pending",
				"Partially Ordered",
				"Ordered",
				"Issued",
				"Transferred",
				"Received",
			],
		)

		validate_for_items(self)

		self.set_title()
		# self.validate_qty_against_so()
		# NOTE: Since Item BOM and FG quantities are combined, using current data, it cannot be validated
		# Though the creation of Material Request from a Production Plan can be rethought to fix this

		self.reset_default_field_value("set_warehouse", "items", "warehouse")
		self.reset_default_field_value("set_from_warehouse", "items", "from_warehouse")

		#postex 
		if self.type == 'Pick & Pack':
			for i in self.items:
				if self.workflow_state == 'To Pick':
					if i.required_quantity != i.qty:
						frappe.throw(f"Required quantity and pick quantity should be same for item:'{i.item_name}'")
				elif self.workflow_state == 'To Pack':
					if i.qty != i.pack_quantity:
						frappe.throw(f"Pick quantity and pack quantity should be same for item:'{i.item_name}'")
		elif self.type == 'Put Away Return':
			for i in self.items:
				print(i)
		if self.type == 'Pick & Pack' or self.type == 'Put Away Return':
			for i in self.dn_mr_item:				
				frappe.db.set_value('Delivery Note',i.against,'custom_dn_selected',1)
				frappe.db.commit()
		elif self.type == 'Put Away GRN':
			for i in self.mr_se_item:				
				frappe.db.set_value('Stock Entry',i.against,'custom_se_selected',1)
				frappe.db.commit()


	def before_update_after_submit(self):
		self.validate_schedule_date()

	def validate_material_request_type(self):
		"""Validate fields in accordance with selected type"""

		if self.material_request_type != "Customer Provided":
			self.customer = None

	def set_title(self):
		"""Set title as comma separated list of items"""
		# if not self.title:
		# 	items = ", ".join([d.item_name for d in self.items][:3])
		# 	self.title = _("{0} Request for {1}").format(self.material_request_type, items)[:100]
		self.title = 'Bulk Actions'

	def on_submit(self):
		#Postex
		try:
			self.update_requested_qty_in_production_plan()
			self.update_requested_qty()
			if self.material_request_type == "Purchase":
				self.validate_budget()
			if self.type == 'Pick & Pack':
				dns = ', '.join(f'"{i.against}"' for i in self.dn_mr_item)
				frappe.db.sql(f"""UPDATE `tabDelivery Note` set custom_picking_bin = '{self.picking_bin}', workflow_state = 'To Pack' WHERE name in ({dns})""")
				frappe.db.sql(f"""UPDATE `tabDelivery Note Item` set warehouse = '{self.set_warehouse}' WHERE parent in ({dns})""")
				frappe.db.sql(f"""UPDATE `tabPicking Bin` set occupied = 0 WHERE name = '{self.picking_bin}'""")
				se = make_stock_entry(self.name)
				for i in se.items:
					i.t_warehouse = self.set_warehouse
				se.custom_main_location = self.custom_location
				se.save(ignore_permissions=True)
				se.submit()
				for i in self.dn_mr_item:
					dn = frappe.get_doc('Delivery Note',i.against)
					dn.submit()
			elif self.type == 'Put Away GRN':
				se = ', '.join(f'"{i.against}"' for i in self.mr_se_item)
				for i in self.items:
					frappe.db.sql(f"""UPDATE `tabStock Entry Detail` set t_warehouse = '{i.from_warehouse}' WHERE item_code = '{i.item_code}' and parent in ({se})""",auto_commit=True)
				for s in self.mr_se_item:
					frappe.db.sql(f"""UPDATE `tabStock Entry` set custom_against_mr = '{self.name}' WHERE name = '{s.against}'""",auto_commit=True)
					d = frappe.get_doc('Stock Entry',s.against)
					d.submit()
			elif self.type == 'Put Away Return':
				for i in self.items:
					if i.split_wise == 1:
						data = json.loads(i.split_data)
						for d in data:
							frappe.db.sql(f"""UPDATE `tabDelivery Note Return Item` set accepted_quantity = '{d.get('a_qty')}', rejected_quantity = '{d.get('r_qty')}', short_quantity = '{d.get('s_qty')}', a_warehouse = '{i.from_warehouse}', r_warehouse = '{self.set_warehouse}' WHERE sku = '{i.item_code}' and parent = '{d.get('parent')}'""",auto_commit=True)
				for d in self.dn_mr_item:
					dn = frappe.get_doc('Delivery Note',d.against)
					if (dn.docstatus == 0):
						# frappe.db.sql(f"update `tabDelivery Note` set workflow_state = 'To QC' WHERE name = '{d.against}'",auto_commit=True)					
						dn.workflow_state = 'To QC'
						dn.save()
						dn.submit()
		except Exception as e:
			frappe.db.rollback()
			frappe.throw(f"{str(e)}")
	def before_save(self):
		if self.workflow_state == None or self.workflow_state == 'To Pick':
			if self.type == 'Pick & Pack' and self.workflow_state != 'To Pack':
				self.workflow_state = 'To Pick'
			elif self.type == 'Put Away GRN' and self.workflow_state != 'Approved' :
				self.workflow_state = 'Draft'
			elif self.type == 'Put Away Return' and self.workflow_state != 'Quality Check' :
				self.workflow_state = 'Received'
				# self.naming_series = 'MAT-DN-RET-.YYYY.-'
		if self.type == 'Pick & Pack' or self.type == 'Put Away Return':
			for i in self.dn_mr_item:				
				frappe.db.set_value('Delivery Note',i.against,'custom_dn_selected',1)
				frappe.db.commit()
		elif self.type == 'Put Away GRN':
			for i in self.mr_se_item:				
				frappe.db.set_value('Stock Entry',i.against,'custom_se_selected',1)
				frappe.db.commit()

		# self.set_status(update=True)

	# def before_submit(self):
		# self.set_status(update=True)

	def before_cancel(self):
		# if MRQ is already closed, no point saving the document
		check_on_hold_or_closed_status(self.doctype, self.name)

		# self.set_status(update=True, status="Cancelled")

	def check_modified_date(self):
		mod_db = frappe.db.sql(
			"""select modified from `tabMaterial Request` where name = %s""", self.name
		)
		date_diff = frappe.db.sql(
			"""select TIMEDIFF('%s', '%s')""" % (mod_db[0][0], cstr(self.modified))
		)

		if date_diff and date_diff[0][0]:
			frappe.throw(_("{0} {1} has been modified. Please refresh.").format(_(self.doctype), self.name))

	def update_status(self, status):
		self.check_modified_date()
		self.status_can_change(status)
		self.set_status(update=True, status=status)
		self.update_requested_qty()

	def status_can_change(self, status):
		"""
		validates that `status` is acceptable for the present controller status
		and throws an Exception if otherwise.
		"""
		if self.status and self.status == "Cancelled":
			# cancelled documents cannot change
			if status != self.status:
				frappe.throw(
					_("{0} {1} is cancelled so the action cannot be completed").format(
						_(self.doctype), self.name
					),
					frappe.InvalidStatusError,
				)

		elif self.status and self.status == "Draft":
			# draft document to pending only
			if status != "Pending":
				frappe.throw(
					_("{0} {1} has not been submitted so the action cannot be completed").format(
						_(self.doctype), self.name
					),
					frappe.InvalidStatusError,
				)

	def on_cancel(self):
		self.update_requested_qty_in_production_plan()
		self.update_requested_qty()

	def get_mr_items_ordered_qty(self, mr_items):
		mr_items_ordered_qty = {}
		mr_items = [d.name for d in self.get("items") if d.name in mr_items]

		doctype = qty_field = None
		if self.material_request_type in ("Material Issue", "Material Transfer", "Customer Provided"):
			doctype = frappe.qb.DocType("Stock Entry Detail")
			qty_field = doctype.transfer_qty
		elif self.material_request_type == "Manufacture":
			doctype = frappe.qb.DocType("Work Order")
			qty_field = doctype.qty

		if doctype and qty_field:
			query = (
				frappe.qb.from_(doctype)
				.select(doctype.material_request_item, Sum(qty_field))
				.where(
					(doctype.material_request == self.name)
					& (doctype.material_request_item.isin(mr_items))
					& (doctype.docstatus == 1)
				)
				.groupby(doctype.material_request_item)
			)

			mr_items_ordered_qty = frappe._dict(query.run())

		return mr_items_ordered_qty

	def update_completed_qty(self, mr_items=None, update_modified=True):
		if self.material_request_type == "Purchase":
			return

		if not mr_items:
			mr_items = [d.name for d in self.get("items")]

		mr_items_ordered_qty = self.get_mr_items_ordered_qty(mr_items)
		mr_qty_allowance = frappe.db.get_single_value("Stock Settings", "mr_qty_allowance")

		# for d in self.get("items"):
		# 	precision = d.precision("ordered_qty")
		# 	if d.name in mr_items:
		# 		if self.material_request_type in ("Material Issue", "Material Transfer", "Customer Provided"):
		# 			d.ordered_qty = flt(mr_items_ordered_qty.get(d.name))

		# 			if mr_qty_allowance:
		# 				allowed_qty = flt((d.qty + (d.qty * (mr_qty_allowance / 100))), precision)

		# 				if d.ordered_qty and d.ordered_qty > allowed_qty:
		# 					frappe.throw(
		# 						_(
		# 							"The total Issue / Transfer quantity {0} in Material Request {1}  cannot be greater than allowed requested quantity {2} for Item {3}"
		# 						).format(d.ordered_qty, d.parent, allowed_qty, d.item_code)
		# 					)

		# 			elif d.ordered_qty and flt(d.ordered_qty, precision) > flt(d.stock_qty, precision):
		# 				frappe.throw(
		# 					_(
		# 						"The total Issue / Transfer quantity {0} in Material Request {1} cannot be greater than requested quantity {2} for Item {3}"
		# 					).format(d.ordered_qty, d.parent, d.stock_qty, d.item_code)
		# 				)

		# 		elif self.material_request_type == "Manufacture":
		# 			d.ordered_qty = flt(mr_items_ordered_qty.get(d.name))

		# 		frappe.db.set_value(d.doctype, d.name, "ordered_qty", d.ordered_qty)

		self._update_percent_field(
			{
				"target_dt": "Material Request Item",
				"target_parent_dt": self.doctype,
				"target_parent_field": "per_ordered",
				"target_ref_field": "stock_qty",
				"target_field": "ordered_qty",
				"name": self.name,
			},
			update_modified,
		)

	def update_requested_qty(self, mr_item_rows=None):
		"""update requested qty (before ordered_qty is updated)"""
		item_wh_list = []
		for d in self.get("items"):
			if (
				(not mr_item_rows or d.name in mr_item_rows)
				and [d.item_code, d.warehouse] not in item_wh_list
				and d.warehouse
				and frappe.db.get_value("Item", d.item_code, "is_stock_item") == 1
			):
				item_wh_list.append([d.item_code, d.warehouse])

		for item_code, warehouse in item_wh_list:
			update_bin_qty(
				item_code,
				warehouse,
				{
					"indented_qty": get_indented_qty(item_code, warehouse),
				},
			)

	def update_requested_qty_in_production_plan(self):
		production_plans = []
		for d in self.get("items"):
			if d.production_plan and d.material_request_plan_item:
				qty = d.qty if self.docstatus == 1 else 0
				frappe.db.set_value(
					"Material Request Plan Item", d.material_request_plan_item, "requested_qty", qty
				)

				if d.production_plan not in production_plans:
					production_plans.append(d.production_plan)

		for production_plan in production_plans:
			doc = frappe.get_doc("Production Plan", production_plan)
			doc.set_status()
			doc.db_set("status", doc.status)

	@frappe.whitelist()
	def get_item_details_by_cn_barcode(self):
		# validate cn scan duplication
		dn_against_cn = set()
		for dn in self.dn_mr_item:
			dn_against_cn.add(dn.against)
		
		validate_cn_query = """
			SELECT name 
			FROM `tabDelivery Note`
			WHERE custom_cn = %s
		"""
		validate_cn_obj = frappe.db.sql(validate_cn_query, self.custom_scan_cn_barcode, as_dict=True)
		
		for dn in validate_cn_obj:
			if dn.name in dn_against_cn:
				frappe.throw(_(f"The CN has been scanned already"))

		dn_query = """
			SELECT * FROM `tabDelivery Note`
			WHERE
				custom_cn = %s AND
				custom_against_mr IS NULL AND
				custom_dn_selected = 0 AND
				workflow_state = 'To Return' AND
				is_return = 1 AND
				company = %s AND
				custom_location = %s
		"""

		dn_obj = frappe.db.sql(dn_query, (self.custom_scan_cn_barcode, self.company, self.custom_location), as_dict=True)

		if not dn_obj:
			frappe.throw(_(f"Current CN: {self.custom_scan_cn_barcode} does not meet the criteria. Please verify workflow_state, is_return and custom_location."))
		else:
			dn_obj = dn_obj[0]

		dn = frappe.get_doc('Delivery Note', dn_obj.name)
		
		i_c = []
		for mi in self.items:
			i_c.append(mi.item_code)

		for i in dn.delivery_note_item:
			if i.sku in i_c:
				for mi in self.items:
					if mi.item_code == i.sku:
						mi.required_quantity += i.total_quantity
						mi.qty += i.total_quantity
						split_data = json.loads(mi.split_data)
						split_data.append({"cn":dn.custom_cn,"qty":i.total_quantity,"a_qty":i.total_quantity,"r_qty":0,"s_qty":0,"parent":dn.name})
						mi.split_data = json.dumps(split_data)
						mi.split_wise = 1
			else:
				target_d = frappe.new_doc("Material Request Item", self, "items")
				target_d.item_code = i.sku
				target_d.item_name = i.product_name
				target_d.required_quantity = i.total_quantity
				target_d.qty = i.total_quantity
				target_d.description = i.product_name
				target_d.uom = 'Nos'
				target_d.conversion_factor = 1
				target_d.schedule_date = self.transaction_date
				target_d.from_warehouse = frappe.db.get_value('Item Default',{"parent":i.sku},'default_warehouse')
				split_data = [{"cn":dn.custom_cn,"qty":i.total_quantity,"a_qty":i.total_quantity,"r_qty":0,"s_qty":0,"parent":dn.name}]
				target_d.split_data = json.dumps(split_data)
				target_d.split_wise = 1
				self.append("items", target_d)
			nc = frappe.new_doc("MR DN Item", self, "dn_mr_item")
			nc.against = dn.name
			nc.sku = i.sku
			nc.product_name = i.product_name
			nc.qauntity = i.total_quantity
			self.append("dn_mr_item", nc)


def update_completed_and_requested_qty(stock_entry, method):
	if stock_entry.doctype == "Stock Entry":
		material_request_map = {}

		for d in stock_entry.get("items"):
			if d.material_request:
				material_request_map.setdefault(d.material_request, []).append(d.material_request_item)

		for mr, mr_item_rows in material_request_map.items():
			if mr and mr_item_rows:
				mr_obj = frappe.get_doc("Material Request", mr)

				if mr_obj.status in ["Stopped", "Cancelled"]:
					frappe.throw(
						_("{0} {1} is cancelled or stopped").format(_("Material Request"), mr),
						frappe.InvalidStatusError,
					)

				mr_obj.update_completed_qty(mr_item_rows)
				mr_obj.update_requested_qty(mr_item_rows)


def set_missing_values(source, target_doc):
	if target_doc.doctype == "Purchase Order" and getdate(target_doc.schedule_date) < getdate(
		nowdate()
	):
		target_doc.schedule_date = None
	target_doc.run_method("set_missing_values")
	target_doc.run_method("set_missing_values")
	target_doc.run_method("calculate_taxes_and_totals")


def update_item(obj, target, source_parent):
	target.conversion_factor = obj.conversion_factor
	target.qty = flt(flt(obj.stock_qty) - flt(obj.ordered_qty)) / target.conversion_factor
	target.stock_qty = target.qty * target.conversion_factor
	if getdate(target.schedule_date) < getdate(nowdate()):
		target.schedule_date = None


def get_list_context(context=None):
	from erpnext.controllers.website_list_for_contact import get_list_context

	list_context = get_list_context(context)
	list_context.update(
		{
			"show_sidebar": True,
			"show_search": True,
			"no_breadcrumbs": True,
			"title": _("Material Request"),
		}
	)

	return list_context


@frappe.whitelist()
def update_status(name, status):
	material_request = frappe.get_doc("Material Request", name)
	material_request.check_permission("write")
	material_request.update_status(status)


@frappe.whitelist()
def make_purchase_order(source_name, target_doc=None, args=None):
	if args is None:
		args = {}
	if isinstance(args, str):
		args = json.loads(args)

	def postprocess(source, target_doc):
		if frappe.flags.args and frappe.flags.args.default_supplier:
			# items only for given default supplier
			supplier_items = []
			for d in target_doc.items:
				default_supplier = get_item_defaults(d.item_code, target_doc.company).get("default_supplier")
				if frappe.flags.args.default_supplier == default_supplier:
					supplier_items.append(d)
			target_doc.items = supplier_items

		set_missing_values(source, target_doc)

	def select_item(d):
		filtered_items = args.get("filtered_children", [])
		child_filter = d.name in filtered_items if filtered_items else True

		return d.ordered_qty < d.stock_qty and child_filter

	doclist = get_mapped_doc(
		"Material Request",
		source_name,
		{
			"Material Request": {
				"doctype": "Purchase Order",
				"validation": {"docstatus": ["=", 1], "material_request_type": ["=", "Purchase"]},
			},
			"Material Request Item": {
				"doctype": "Purchase Order Item",
				"field_map": [
					["name", "material_request_item"],
					["parent", "material_request"],
					["uom", "stock_uom"],
					["uom", "uom"],
					["sales_order", "sales_order"],
					["sales_order_item", "sales_order_item"],
					["wip_composite_asset", "wip_composite_asset"],
				],
				"postprocess": update_item,
				"condition": select_item,
			},
		},
		target_doc,
		postprocess,
	)

	return doclist


@frappe.whitelist()
def make_request_for_quotation(source_name, target_doc=None):
	doclist = get_mapped_doc(
		"Material Request",
		source_name,
		{
			"Material Request": {
				"doctype": "Request for Quotation",
				"validation": {"docstatus": ["=", 1], "material_request_type": ["=", "Purchase"]},
			},
			"Material Request Item": {
				"doctype": "Request for Quotation Item",
				"field_map": [
					["name", "material_request_item"],
					["parent", "material_request"],
					["uom", "uom"],
				],
			},
		},
		target_doc,
	)

	return doclist


@frappe.whitelist()
def make_purchase_order_based_on_supplier(source_name, target_doc=None, args=None):
	mr = source_name

	supplier_items = get_items_based_on_default_supplier(args.get("supplier"))

	def postprocess(source, target_doc):
		target_doc.supplier = args.get("supplier")
		if getdate(target_doc.schedule_date) < getdate(nowdate()):
			target_doc.schedule_date = None
		target_doc.set(
			"items",
			[
				d for d in target_doc.get("items") if d.get("item_code") in supplier_items and d.get("qty") > 0
			],
		)

		set_missing_values(source, target_doc)

	target_doc = get_mapped_doc(
		"Material Request",
		mr,
		{
			"Material Request": {
				"doctype": "Purchase Order",
			},
			"Material Request Item": {
				"doctype": "Purchase Order Item",
				"field_map": [
					["name", "material_request_item"],
					["parent", "material_request"],
					["uom", "stock_uom"],
					["uom", "uom"],
				],
				"postprocess": update_item,
				"condition": lambda doc: doc.ordered_qty < doc.qty,
			},
		},
		target_doc,
		postprocess,
	)

	return target_doc


@frappe.whitelist()
def get_items_based_on_default_supplier(supplier):
	supplier_items = [
		d.parent
		for d in frappe.db.get_all(
			"Item Default", {"default_supplier": supplier, "parenttype": "Item"}, "parent"
		)
	]

	return supplier_items


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_material_requests_based_on_supplier(doctype, txt, searchfield, start, page_len, filters):
	conditions = ""
	if txt:
		conditions += "and mr.name like '%%" + txt + "%%' "

	if filters.get("transaction_date"):
		date = filters.get("transaction_date")[1]
		conditions += "and mr.transaction_date between '{0}' and '{1}' ".format(date[0], date[1])

	supplier = filters.get("supplier")
	supplier_items = get_items_based_on_default_supplier(supplier)

	if not supplier_items:
		frappe.throw(_("{0} is not the default supplier for any items.").format(supplier))

	material_requests = frappe.db.sql(
		"""select distinct mr.name, transaction_date,company
		from `tabMaterial Request` mr, `tabMaterial Request Item` mr_item
		where mr.name = mr_item.parent
			and mr_item.item_code in ({0})
			and mr.material_request_type = 'Purchase'
			and mr.per_ordered < 99.99
			and mr.docstatus = 1
			and mr.status != 'Stopped'
			and mr.company = %s
			{1}
		order by mr_item.item_code ASC
		limit {2} offset {3} """.format(
			", ".join(["%s"] * len(supplier_items)), conditions, cint(page_len), cint(start)
		),
		tuple(supplier_items) + (filters.get("company"),),
		as_dict=1,
	)

	return material_requests


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def get_default_supplier_query(doctype, txt, searchfield, start, page_len, filters):
	doc = frappe.get_doc("Material Request", filters.get("doc"))
	item_list = []
	for d in doc.items:
		item_list.append(d.item_code)

	return frappe.db.sql(
		"""select default_supplier
		from `tabItem Default`
		where parent in ({0}) and
		default_supplier IS NOT NULL
		""".format(
			", ".join(["%s"] * len(item_list))
		),
		tuple(item_list),
	)


@frappe.whitelist()
def make_supplier_quotation(source_name, target_doc=None):
	def postprocess(source, target_doc):
		set_missing_values(source, target_doc)

	doclist = get_mapped_doc(
		"Material Request",
		source_name,
		{
			"Material Request": {
				"doctype": "Supplier Quotation",
				"validation": {"docstatus": ["=", 1], "material_request_type": ["=", "Purchase"]},
			},
			"Material Request Item": {
				"doctype": "Supplier Quotation Item",
				"field_map": {
					"name": "material_request_item",
					"parent": "material_request",
					"sales_order": "sales_order",
				},
			},
		},
		target_doc,
		postprocess,
	)

	return doclist


@frappe.whitelist()
def make_stock_entry(source_name, target_doc=None):
	def update_item(obj, target, source_parent):
		qty = (
			flt(flt(obj.stock_qty) - flt(obj.ordered_qty)) / target.conversion_factor
			if flt(obj.stock_qty) > flt(obj.ordered_qty)
			else 0
		)
		target.qty = qty
		target.transfer_qty = qty * obj.conversion_factor
		target.conversion_factor = obj.conversion_factor
		target.allow_zero_valuation_rate = 1
		if (
			source_parent.material_request_type == "Material Transfer"
			or source_parent.material_request_type == "Customer Provided"
		):
			target.t_warehouse = obj.warehouse
		else:
			target.s_warehouse = obj.warehouse

		if source_parent.material_request_type == "Customer Provided":
			target.allow_zero_valuation_rate = 1

		if source_parent.material_request_type == "Material Transfer":
			target.s_warehouse = obj.from_warehouse

	def set_missing_values(source, target):
		target.purpose = source.material_request_type
		target.from_warehouse = source.set_from_warehouse
		target.to_warehouse = source.set_warehouse

		if source.job_card:
			target.purpose = "Material Transfer for Manufacture"

		if source.material_request_type == "Customer Provided":
			target.purpose = "Material Receipt"

		target.set_transfer_qty()
		target.set_actual_qty()
		target.calculate_rate_and_amount(raise_error_if_no_rate=False)
		target.stock_entry_type = target.purpose
		target.set_job_card_data()

		if source.job_card:
			job_card_details = frappe.get_all(
				"Job Card", filters={"name": source.job_card}, fields=["bom_no", "for_quantity"]
			)

			if job_card_details and job_card_details[0]:
				target.bom_no = job_card_details[0].bom_no
				target.fg_completed_qty = job_card_details[0].for_quantity
				target.from_bom = 1

	doclist = get_mapped_doc(
		"Material Request",
		source_name,
		{
			"Material Request": {
				"doctype": "Stock Entry",
				"validation": {
					"docstatus": ["=", 1],
					"material_request_type": ["in", ["Material Transfer", "Material Issue", "Customer Provided"]],
				},
			},
			"Material Request Item": {
				"doctype": "Stock Entry Detail",
				"field_map": {
					"name": "material_request_item",
					"parent": "material_request",
					"uom": "stock_uom",
					"job_card_item": "job_card_item",
					1:"allow_zero_valuation_rate"
				},
				"postprocess": update_item,
				"condition": lambda doc: (
					flt(doc.ordered_qty, doc.precision("ordered_qty"))
					< flt(doc.stock_qty, doc.precision("ordered_qty"))
				),
			},
		},
		target_doc,
		set_missing_values,
	)
	# check for the previous SE
	entries = frappe.get_list('Stock Entry',{'custom_against_mr':source_name})
	for e in entries:
		std = frappe.get_list('Stock Ledger Entry',{'voucher_no':e.name})
		for i in std:
			d = frappe.get_doc('Stock Ledger Entry',i.name)
			for di in doclist.items:
				if d.item_code == di.item_code:
					di.actual_qty -= d.actual_qty
	return doclist


@frappe.whitelist()
def raise_work_orders(material_request):
	mr = frappe.get_doc("Material Request", material_request)
	errors = []
	work_orders = []
	default_wip_warehouse = frappe.db.get_single_value(
		"Manufacturing Settings", "default_wip_warehouse"
	)

	for d in mr.items:
		if (d.stock_qty - d.ordered_qty) > 0:
			if frappe.db.exists("BOM", {"item": d.item_code, "is_default": 1}):
				wo_order = frappe.new_doc("Work Order")
				wo_order.update(
					{
						"production_item": d.item_code,
						"qty": d.stock_qty - d.ordered_qty,
						"fg_warehouse": d.warehouse,
						"wip_warehouse": default_wip_warehouse,
						"description": d.description,
						"stock_uom": d.stock_uom,
						"expected_delivery_date": d.schedule_date,
						"sales_order": d.sales_order,
						"sales_order_item": d.get("sales_order_item"),
						"bom_no": get_item_details(d.item_code).bom_no,
						"material_request": mr.name,
						"material_request_item": d.name,
						"planned_start_date": mr.transaction_date,
						"company": mr.company,
					}
				)

				wo_order.set_work_order_operations()
				wo_order.flags.ignore_mandatory = True
				wo_order.save()

				work_orders.append(wo_order.name)
			else:
				errors.append(
					_("Row {0}: Bill of Materials not found for the Item {1}").format(
						d.idx, get_link_to_form("Item", d.item_code)
					)
				)

	if work_orders:
		work_orders_list = [get_link_to_form("Work Order", d) for d in work_orders]

		if len(work_orders) > 1:
			msgprint(
				_("The following {0} were created: {1}").format(
					frappe.bold(_("Work Orders")), "<br>" + ", ".join(work_orders_list)
				)
			)
		else:
			msgprint(
				_("The {0} {1} created sucessfully").format(frappe.bold(_("Work Order")), work_orders_list[0])
			)

	if errors:
		frappe.throw(
			_("Work Order cannot be created for following reason: <br> {0}").format(new_line_sep(errors))
		)

	return work_orders


@frappe.whitelist()
def create_pick_list(source_name, target_doc=None):
	doc = get_mapped_doc(
		"Material Request",
		source_name,
		{
			"Material Request": {
				"doctype": "Pick List",
				"field_map": {"material_request_type": "purpose"},
				"validation": {"docstatus": ["=", 1]},
			},
			"Material Request Item": {
				"doctype": "Pick List Item",
				"field_map": {"name": "material_request_item", "qty": "stock_qty"},
			},
		},
		target_doc,
	)

	doc.set_item_locations()

	return doc


@frappe.whitelist()
def make_in_transit_stock_entry(source_name, in_transit_warehouse):
	ste_doc = make_stock_entry(source_name)
	ste_doc.add_to_transit = 1
	ste_doc.to_warehouse = in_transit_warehouse

	for row in ste_doc.items:
		row.t_warehouse = in_transit_warehouse

	return ste_doc

@frappe.whitelist()
def generate_bulk_pdf(docname):
	doc = frappe.get_doc('Material Request',docname)
	pdf_data = ''			
	if doc.type == 'Pick & Pack' or doc.type == 'Put Away Return':
		pdf_data = frappe.get_template("postex/templates/gdn.html").render({"doc":doc})
	else:
		pdf_data = frappe.get_template("postex/templates/grn.html").render({"doc":doc})
	from frappe.utils.pdf import get_pdf
	pdf = get_pdf(pdf_data)	
	filename = f"{docname}.pdf"
	try:
		# Send the PDF file as a response
		frappe.local.response.filename = filename
		frappe.local.response.filecontent = pdf
		frappe.local.response.type = 'download'			# Delete the PDF file after it has been sent
	except Exception as e:
		frappe.log_error(f"Error: {str(e)}", title="PDF Download Error")
		frappe.response['error'] = str(e)		


@frappe.whitelist()
def generate_bulk_airway_pdf(docname):
	import PyPDF2
	from io import BytesIO
	import os
	import requests
	
	def download_pdf_from_link(pdf_link):
		# Download the PDF file from the public link
		response = requests.get(pdf_link)
		
		# Check if the request was successful
		if response.status_code == 200:
			return BytesIO(response.content)  # Return PDF content as BytesIO object
		else:
			frappe.msgprint(_("Failed to download PDF from link: {0}").format(pdf_link))
			return None	
	doc = frappe.get_doc('Material Request',docname)
	pdf_data = ''
	pdf_writer = PyPDF2.PdfWriter()
	if doc.type == 'Pick & Pack':		
		for d in doc.dn_mr_item:
			airway_bill = frappe.get_value('Delivery Note',d.against,"custom_airway_bill")
			pdf_bytesio = download_pdf_from_link(airway_bill)			
			if pdf_bytesio:
				pdf_reader = PyPDF2.PdfReader(pdf_bytesio)
				for page_num in range(len(pdf_reader.pages)):
					pdf_writer.add_page(pdf_reader.pages[page_num])			

	merged_pdf_bytes = BytesIO()
	pdf_writer.write(merged_pdf_bytes)
	merged_pdf_bytes.seek(0)
	file_bytes = merged_pdf_bytes.getvalue()        
	# Write the bytes to a temporary file
	temp_file = 'merged_pdf.pdf'  # Change the path as needed
	with open(temp_file, "wb") as fileobj:
		fileobj.write(file_bytes)
	with open(temp_file, "rb") as fileobj:		
		filedata = fileobj.read()

	frappe.local.response.filename = os.path.basename(temp_file)
	frappe.local.response.filecontent = filedata
	frappe.local.response.type = "download"
	os.remove(temp_file)

