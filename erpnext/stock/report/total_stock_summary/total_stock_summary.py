# Copyright (c) 2013, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt


import frappe
from frappe import _
from frappe.query_builder.functions import Sum


def execute(filters=None):

	if not filters:
		filters = {}
	columns = get_columns(filters)
	stock = get_total_stock(filters)

	return columns, stock


def get_columns(filters):
	columns = [
		_("Item") + ":Link/Item:150",
		_("Description") + "::300",
		_("Current Qty") + ":Float:100",
	]

	if filters.get("group_by") == "Warehouse":
		columns.insert(0, _("Warehouse") + ":Link/Warehouse:150")
	else:
		columns.insert(0, _("Company") + ":Link/Company:250")

	return columns


def get_total_stock(filters):
	bin = frappe.qb.DocType("Stock Ledger Entry")
	item = frappe.qb.DocType("Item")
	warehouse = frappe.qb.DocType("Warehouse")

	query = (
		frappe.qb.from_(bin)
		.inner_join(item)
		.on(bin.item_code == item.item_code)
		.inner_join(warehouse).on(bin.warehouse == warehouse.name)
		.where(bin.actual_qty != 0)
	)

	if filters.get("group_by") == "Warehouse":
		if filters.get("company"):
			query = query.where(bin.company == filters.get("company"))

		query = query.select(warehouse.warehouse_name).groupby(bin.warehouse)
	else:
		query = query.select(bin.company).groupby(bin.company)

	query = query.select(
		item.item_code, item.description, Sum(bin.actual_qty).as_("actual_qty")
	).groupby(item.item_code)

	return query.run()
