# Copyright (c) 2023, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	columns, data = [], []
	columns = get_columns(filters)
	merchant = frappe.db.get_value('User Permission',{'user':frappe.session.user,'allow':"Company",'is_default':1},'for_value')
	data = frappe.db.sql(f"""SELECT i.custom_sku,i.item_name,sle.warehouse, sum(sle.actual_qty) AS qty, wh.custom_is_main_location, wh.parent_warehouse
					  FROM `tabStock Ledger Entry` AS sle
					  JOIN `tabItem` AS i on i.item_code = sle.item_code
					  JOIN `tabWarehouse` AS wh ON sle.warehouse = wh.name
					  WHERE i.custom_merchant = '{merchant}' 
					  GROUP BY i.item_code,sle.warehouse""",as_dict=True)
	
	# create warehouse_cache dict using only one get_all to fetch all warehouses 
	# at once instead of multiple get_doc's
	warehouse_cache = {}
	warehouses = frappe.get_all(
		"Warehouse", 
		fields=["name", "custom_is_main_location", "warehouse_name", "parent_warehouse"]
	)
	for wh in warehouses:
		warehouse_cache[wh["name"]] = wh
	
	for d in data:
		main_location=0
		while main_location == 0:
			if d["parent_warehouse"] in warehouse_cache:
				pwh = warehouse_cache.get(d["parent_warehouse"])
				main_location = pwh.custom_is_main_location
				d['warehouse'] = pwh.warehouse_name
				d['parent_warehouse'] = pwh.parent_warehouse
			else:
				main_location = 1

	grouped_data = {}
	for item in data:
		key = (item['custom_sku'], item['warehouse'])
		
		if key in grouped_data:
			grouped_data[key]['qty'] += item['qty']
		else:
			grouped_data[key] = {
				'custom_sku': item['custom_sku'],
				'item_name': item['item_name'],
				'qty': item['qty'],
				'warehouse': item['warehouse']
			}

	data = list(grouped_data.values())

	return columns, data

def get_columns(filters):
	columns = [
		{"label": _("SKU"), "fieldname": "custom_sku", "fieldtype": "data", "width": 380,"align":"left"},
		{"label": _("Product"), "fieldname": "item_name", "fieldtype": "data", "width": 380},
		{"label": _("Warehouse"), "fieldname": "warehouse", "fieldtype": "data", "width": 300},
		{"label": _("Quantity"), "fieldname": "qty", "fieldtype": "int", "width": 150},
	]
	return columns