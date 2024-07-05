// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

// eslint-disable-next-line
frappe.provide("erpnext.accounts.dimensions");
{% include 'erpnext/public/js/controllers/buying.js' %};
// var role = ''
frappe.ui.form.on('Material Request', {
	picking_bin: function(frm){
		frappe.db.set_value('Picking Bin',frm.doc.picking_bin,'occupied',1);
	},
	type: function(frm){
		updateChildTable(frm);
		frm.clear_table('items');
		frm.clear_table('dn_mr_items');
		frm.clear_table('mr_se_item');
		changeButtons(frm)
	},
	custom_scan_barcode:function(frm){
		if (frm.doc.custom_barcode != ''){
			frappe.call({
				method: "postex.api.dn.get_item_by_barcode",
				type: "GET",
				args: {
					"barcode":frm.doc.custom_scan_barcode
				},
				callback: function (r) {
					var item_code = r.message;
					frm.doc.items.forEach(function(d){
						if (d.item_code == item_code){
							if(frm.doc.type == 'Put Away Return'){
								// if(frm.doc.__islocal != undefined){
									if(d.required_quantity > (d.qty - 1)){
										frm.doc.custom_scan_barcode = '';
										frm.refresh_field('custom_scan_barcode');
										frappe.throw("You cannot add item more then total quantity");
									}
									d.qty -= 1;
								// }else{
								// 	if(d.qty > (d.pack_quantity - 1)){
								// 		frm.doc.custom_scan_barcode = '';
								// 		frm.refresh_field('custom_scan_barcode');
								// 		frappe.throw("You cannot add item more then accepted quantity");
								// 	}
								// 	d.pack_quantity -= 1;
								// }
							}else if(frm.doc.type == 'Pick & Pack'){
								if(frm.doc.__islocal == undefined || frm.doc.__islocal == 0){
									if(d.qty < (d.pack_quantity + 1)){
										frm.doc.custom_scan_barcode = '';
										frm.refresh_field('custom_scan_barcode');
										frappe.throw("You cannot add item more then pick quantity");
									}
									d.pack_quantity += 1;
								}else{
									if(d.required_quantity < (d.qty + 1)){
										frm.doc.custom_scan_barcode = '';
										frm.refresh_field('custom_scan_barcode');
										frappe.throw("You cannot add item more then required quantity");
									}
									d.qty += 1;
								}
	
							}else if(frm.doc.type == 'Put Away GRN'){
								if(frm.doc.__islocal == undefined || frm.doc.__islocal == 0){								
									if(d.qty < (d.pack_quantity + 1)){
										frm.doc.custom_scan_barcode = '';
										frm.refresh_field('custom_scan_barcode');
										frappe.throw("You cannot add item more then quantity");
									}
									d.pack_quantity += 1;
								// }else{
								// 	if(d.required_quantity < (d.qty + 1)){
								// 		frm.doc.custom_scan_barcode = '';
								// 		frm.refresh_field('custom_scan_barcode');
								// 		frappe.throw("You cannot add item more then required quantity");
								// 	}
								// 	d.qty += 1;
								}
	
							}
							frm.refresh_field('items');
							frm.doc.custom_scan_barcode = '';
							frm.refresh_field('custom_scan_barcode');
						}
					});
				},
			});		
		}


	},
	setup: function(frm) {
		// fetchRoleProfile();
		frm.custom_make_buttons = {
			'Stock Entry': 'Issue Material',
			'Pick List': 'Pick List',
			'Purchase Order': 'Purchase Order',
			'Request for Quotation': 'Request for Quotation',
			'Supplier Quotation': 'Supplier Quotation',
			'Work Order': 'Work Order',
			'Purchase Receipt': 'Purchase Receipt'
		};

		// formatter for material request item
		frm.set_indicator_formatter('item_code',
			function(doc) { return (doc.stock_qty<=doc.ordered_qty) ? "green" : "orange"; });

		frm.set_query("item_code", "items", function() {
			return {
				query: "erpnext.controllers.queries.item_query"
			};
		});

		frm.set_query("from_warehouse", "items", function(doc) {
			return {
				filters: {'company': doc.company}
			};
		});

		frm.set_query("bom_no", "items", function(doc, cdt, cdn) {
			var row = locals[cdt][cdn];
			return {
				filters: {
					"item": row.item_code
				}
			}
		});
		frm.set_df_property('naming_series','hidden',1);
		frm.set_query('picking_bin', function() {
			return {
				filters: {
					'location':frm.doc.custom_location,
					'occupied': 0
				}
			}
		});		
		updateChildTable(frm);
		bulkPrintOption(frm,'setup');
	},

	onload: function(frm) {
		// add item, if previous view was item		
		erpnext.utils.add_item(frm);

		// set schedule_date
		set_schedule_date(frm);

		frm.set_query("warehouse", "items", function(doc) {
			return {
				filters: {'company': doc.company}
			};
		});
		frm.set_query("custom_default_target_bin", function(doc){
			return {
				filters: {
					company: doc.company,
					parent_warehouse:['descendants of',doc.custom_location],
					custom_is_pickable_bin:1

				}
			};
		});

		frm.set_query("set_warehouse", function(doc){
			return {
				filters: {
					company: doc.company,
					parent_warehouse:['descendants of',doc.custom_location],
					custom_packing_area:1

				}
			};
		});
		frm.set_query("custom_location", function(doc){
			return {
				filters: {
					company: doc.company,
					custom_is_main_location : 1
				}
			};
		});

		frm.set_query("set_from_warehouse", function(doc){
			return {
				filters: {
					parent_warehouse:['descendants of',doc.custom_location],
					company: doc.company,
					custom_is_pickable_bin: 1,
					is_group: 0
				}
			};
		});
		frm.set_query("from_warehouse", "items", function(doc, cdt, cdn) {
			let d = locals[cdt][cdn];
			return {
				filters: {
					"parent_warehouse":['descendants of',doc.custom_location],
					company: doc.company,
					custom_is_pickable_bin: 1,
					is_group: 0
				}
			}
		});
		erpnext.accounts.dimensions.setup_dimension_filters(frm, frm.doctype);

		frm.set_df_property('naming_series','hidden',1);
		updateChildTable(frm);
		bulkPrintOption(frm,'onload');

	},
	custom_apply_default_target_bin: function(frm){
		frm.freeze = 1;
		frm.doc.items.forEach(d => {
			frappe.model.set_value(d.doctype, d.name,
				"from_warehouse", frm.doc.custom_default_target_bin);
		});
		refresh_field('items');
		frm.freeze = 0;
	},
	company: function(frm) {
		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
	},

	onload_post_render: function(frm) {
		frm.get_field("items").grid.set_multiple_add("item_code", "qty");
	},

	refresh: function(frm) {
		frm.events.make_custom_buttons(frm);
		frm.toggle_reqd('customer', frm.doc.material_request_type=="Customer Provided");
		frm.set_df_property('naming_series','hidden',1);
		frm.set_df_property('items', 'cannot_add_rows', true);
		frm.set_df_property('items', 'cannot_delete_rows', true);
		updateChildTable(frm);
		bulkPrintOption(frm,'refresh');
	},

	set_from_warehouse: function(frm) {
		if (frm.doc.material_request_type == "Material Transfer"
			&& frm.doc.set_from_warehouse) {
			frm.doc.items.forEach(d => {
				frappe.model.set_value(d.doctype, d.name,
					"from_warehouse", frm.doc.set_from_warehouse);
			})
		}
	},

	make_custom_buttons: function(frm) {
		// if (frm.doc.docstatus==0) {
		// 	frm.add_custom_button(__("Bill of Materials"),
		// 		() => frm.events.get_items_from_bom(frm), __("Fetch Products"));
		// }

		// if (frm.doc.docstatus == 1 && frm.doc.status != 'Stopped') {
			// let precision = frappe.defaults.get_default("float_precision");

			// if (flt(frm.doc.per_received, precision) < 100) {
			// 	frm.add_custom_button(__('Stop'),
			// 		() => frm.events.update_status(frm, 'Stopped'));
			// }

			// if (flt(frm.doc.per_ordered, precision) < 100) {
			// 	let add_create_pick_list_button = () => {
			// 		frm.add_custom_button(__('Pick List'),
			// 			() => frm.events.create_pick_list(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === 'Material Transfer') {
			// 		add_create_pick_list_button();
			// 		frm.add_custom_button(__('Material Transfer'),
			// 			() => frm.events.make_stock_entry(frm), __('Create'));

			// 		frm.add_custom_button(__('Material Transfer (In Transit)'),
			// 			() => frm.events.make_in_transit_stock_entry(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Material Issue") {
			// 		frm.add_custom_button(__("Issue Material"),
			// 			() => frm.events.make_stock_entry(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Customer Provided") {
			// 		frm.add_custom_button(__("Material Receipt"),
			// 			() => frm.events.make_stock_entry(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Purchase") {
			// 		frm.add_custom_button(__('Purchase Order'),
			// 			() => frm.events.make_purchase_order(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Purchase") {
			// 		frm.add_custom_button(__("Request for Quotation"),
			// 			() => frm.events.make_request_for_quotation(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Purchase") {
			// 		frm.add_custom_button(__("Supplier Quotation"),
			// 			() => frm.events.make_supplier_quotation(frm), __('Create'));
			// 	}

			// 	if (frm.doc.material_request_type === "Manufacture") {
			// 		frm.add_custom_button(__("Work Order"),
			// 			() => frm.events.raise_work_orders(frm), __('Create'));
			// 	}

			// 	frm.page.set_inner_btn_group_as_primary(__('Create'));
			// }
		// }

		if (frm.doc.docstatus==0 && frm.is_new()) {			
			frm.add_custom_button(__('GDN'), () => frm.events.get_items_from_sales_order(frm),
				__("Fetch Products"));
		}

		if (frm.doc.docstatus == 1 && frm.doc.status == 'Stopped') {
			frm.add_custom_button(__('Re-open'), () => frm.events.update_status(frm, 'Submitted'));
		}
	},

	update_status: function(frm, stop_status) {
		frappe.call({
			method: 'erpnext.stock.doctype.material_request.material_request.update_status',
			args: { name: frm.doc.name, status: stop_status },
			callback(r) {
				if (!r.exc) {
					frm.reload_doc();
				}
			}
		});
	},
	bulk_print: function(frm) {
		open_url_post(
			'/api/method/erpnext.stock.doctype.material_request.material_request.generate_bulk_pdf',
			{
				docname: frm.doc.name
			}
		);
	},
	bulk_airway_print: function(frm) {
		open_url_post(
			'/api/method/erpnext.stock.doctype.material_request.material_request.generate_bulk_airway_pdf',
			{
				docname: frm.doc.name
			}
		);
		// frappe.call({
		// 	method: 'erpnext.stock.doctype.material_request.material_request.generate_bulk_airway_pdf',
		// 	args: {
		// 		docname: frm.doc.name  // List of PDF file paths to merge
		// 	},
		// 	callback: function(response) {
		// 		if (!response.exc && !response.error) {
		// 			var blob = new Blob([response.message], { type: 'application/pdf' });
		// 			var link = document.createElement('a');
		// 			link.href = window.URL.createObjectURL(blob);
		// 			link.download = 'merged_pdf.pdf';
		// 			link.click();
		// 		} else {
		// 			frappe.msgprint('Failed to merge PDFs: ' + response.error || response.exc || '');
		// 		}
		// 	}
		// });		
	},

	get_items_from_sales_order: function(frm) {
		if (frm.doc.custom_location == "" || frm.doc.custom_location == undefined){
			frappe.throw("Please select location first!");
		}
		if (frm.doc.set_warehouse == "" || frm.doc.set_warehouse == undefined){
			frappe.throw("Please select Packing Location first!");
		}
		erpnext.utils.map_current_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_material_request",
			source_doctype: "Delivery Note",
			target: frm,
			setters: {
				custom_store_order_ref_id: undefined,
				custom_cn: undefined,
				// custom_location: undefined,
			},
			columns:["posting_date","custom_cn","custom_store_order_ref_id"],
			get_query_filters: {
				docstatus: 0,
				// status: ["not in", ["Closed", "On Hold"]],
				// per_delivered: ["<", 99.99],			
				custom_against_mr:["is","not set"],
				custom_dn_selected:0,
				workflow_state:'To Pick',	
				company: frm.doc.company,
				custom_location : frm.doc.custom_location
			},
			primary_action_label : 'Select Orders',
		});
	},
	get_items_from_grn: function(frm) {
		if (frm.doc.custom_location == "" || frm.doc.custom_location == undefined){
			frappe.throw("Please select location first!");
		}
		erpnext.utils.map_current_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_grn_material_request",
			source_doctype: "Stock Entry",
			target: frm,
			setters: [{
				fieldtype: 'Link',
				label: __('Main Location'),
				options: 'Warehouse',
				fieldname: 'custom_main_location',
				default: frm.doc.custom_location,
				filters:{
					company: frm.doc.company,
					custom_is_main_location : 1
				}
			}],
			columns:["posting_date","custom_main_location"],
			get_query_filters: {
				docstatus: 0,
				// status: ["not in", ["Closed", "On Hold"]],
				// per_delivered: ["<", 99.99],			
				custom_against_mr:["is","not set"],
				custom_se_selected:0,
				// workflow_state:'To Pick',	
				company: frm.doc.company,
				custom_main_location : frm.doc.custom_location,
				stock_entry_type: 'Put Away GRN'
			},
			primary_action_label : 'Select Orders'
		});
	},
	get_items_from_gdn_return: function(frm) {
		if (frm.doc.custom_location == "" || frm.doc.custom_location == undefined){
			frappe.throw("Please select location first!");
		}
		erpnext.utils.map_current_doc({
			method: "erpnext.selling.doctype.sales_order.sales_order.make_gdn_return_material_request",
			source_doctype: "Delivery Note",
			target: frm,
			setters: {
				custom_store_order_ref_id: undefined,
				custom_cn: undefined,
				// custom_location: undefined,
			},
			columns:["posting_date","custom_cn","custom_store_order_ref_id"],
			get_query_filters: {
				docstatus: 0,
				// status: ["not in", ["Closed", "On Hold"]],
				// per_delivered: ["<", 99.99],			
				custom_against_mr:["is","not set"],
				custom_dn_selected:0,
				workflow_state:'To Return',
				is_return:1,
				company: frm.doc.company,
				custom_location : frm.doc.custom_location
			},
			primary_action_label : 'Select Orders'
		});
	},

	get_item_data: function(frm, item, overwrite_warehouse=false) {
		if (item && !item.item_code) { return; }
		frm.call({
			method: "erpnext.stock.get_item_details.get_item_details",
			child: item,
			args: {
				args: {
					item_code: item.item_code,
					from_warehouse: item.from_warehouse,
					warehouse: item.warehouse,
					doctype: frm.doc.doctype,
					buying_price_list: frappe.defaults.get_default('buying_price_list'),
					currency: frappe.defaults.get_default('Currency'),
					name: frm.doc.name,
					qty: item.qty || 1,
					stock_qty: item.stock_qty,
					company: frm.doc.company,
					conversion_rate: 1,
					material_request_type: frm.doc.material_request_type,
					plc_conversion_rate: 1,
					rate: item.rate,
					uom: item.uom,
					conversion_factor: item.conversion_factor,
					project: item.project,
				},
				overwrite_warehouse: overwrite_warehouse
			},
			callback: function(r) {
				const d = item;
				const qty_fields = ['actual_qty', 'projected_qty', 'min_order_qty'];

				if(!r.exc) {
					$.each(r.message, function(k, v) {
						if(!d[k] || in_list(qty_fields, k)) d[k] = v;
					});
				}
			}
		});
	},

	get_items_from_bom: function(frm) {
		var d = new frappe.ui.Dialog({
			title: __("Fetch Products BOM"),
			fields: [
				{"fieldname":"bom", "fieldtype":"Link", "label":__("BOM"),
					options:"BOM", reqd: 1, get_query: function() {
						return {filters: { docstatus:1 }};
					}},
				{"fieldname":"warehouse", "fieldtype":"Link", "label":__("For Warehouse"),
					options:"Warehouse", reqd: 1},
				{"fieldname":"qty", "fieldtype":"Float", "label":__("Quantity"),
					reqd: 1, "default": 1},
				{"fieldname":"fetch_exploded", "fieldtype":"Check",
					"label":__("Fetch exploded BOM (including sub-assemblies)"), "default":1}
			],
			primary_action_label: 'Select Orders',
			primary_action(values) {
				if(!values) return;
				values["company"] = frm.doc.company;
				if(!frm.doc.company) frappe.throw(__("Company field is required"));
				frappe.call({
					method: "erpnext.manufacturing.doctype.bom.bom.get_bom_items",
					args: values,
					callback: function(r) {
						if (!r.message) {
							frappe.throw(__("BOM does not contain any stock item"));
						} else {
							erpnext.utils.remove_empty_first_row(frm, "items");
							$.each(r.message, function(i, item) {
								var d = frappe.model.add_child(cur_frm.doc, "Material Request Item", "items");
								d.item_code = item.item_code;
								d.item_name = item.item_name;
								d.description = item.description;
								d.warehouse = values.warehouse;
								d.uom = item.stock_uom;
								d.stock_uom = item.stock_uom;
								d.conversion_factor = 1;
								d.qty = item.qty;
								d.project = item.project;
							});
						}
						d.hide();
						refresh_field("items");
					}
				});
			}
		});

		d.show();
	},

	make_purchase_order: function(frm) {
		frappe.prompt(
			{
				label: __('For Default Supplier (Optional)'),
				fieldname:'default_supplier',
				fieldtype: 'Link',
				options: 'Supplier',
				description: __('Select a Supplier from the Default Suppliers of the items below. On selection, a Purchase Order will be made against items belonging to the selected Supplier only.'),
				get_query: () => {
					return{
						query: "erpnext.stock.doctype.material_request.material_request.get_default_supplier_query",
						filters: {'doc': frm.doc.name}
					}
				}
			},
			(values) => {
				frappe.model.open_mapped_doc({
					method: "erpnext.stock.doctype.material_request.material_request.make_purchase_order",
					frm: frm,
					args: { default_supplier: values.default_supplier },
					run_link_triggers: true
				});
			},
			__('Enter Supplier'),
			__('Create')
		)
	},

	make_request_for_quotation: function(frm) {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.material_request.material_request.make_request_for_quotation",
			frm: frm,
			run_link_triggers: true
		});
	},

	make_supplier_quotation: function(frm) {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.material_request.material_request.make_supplier_quotation",
			frm: frm
		});
	},

	make_stock_entry: function(frm) {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.material_request.material_request.make_stock_entry",
			frm: frm
		});
	},

	make_in_transit_stock_entry(frm) {
		frappe.prompt(
			[
				{
					label: __('In Transit Warehouse'),
					fieldname: 'in_transit_warehouse',
					fieldtype: 'Link',
					options: 'Warehouse',
					reqd: 1,
					get_query: () => {
						return{
							filters: {
								'company': frm.doc.company,
								'is_group': 0,
								'warehouse_type': 'Transit'
							}
						}
					}
				}
			],
			(values) => {
				frappe.call({
					method: "erpnext.stock.doctype.material_request.material_request.make_in_transit_stock_entry",
					args: {
						source_name: frm.doc.name,
						in_transit_warehouse: values.in_transit_warehouse
					},
					callback: function(r) {
						if (r.message) {
							let doc = frappe.model.sync(r.message);
							frappe.set_route('Form', doc[0].doctype, doc[0].name);
						}
					}
				})
			},
			__('In Transit Transfer'),
			__('Create Stock Entry')
		)
	},

	create_pick_list: (frm) => {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.material_request.material_request.create_pick_list",
			frm: frm
		});
	},

	raise_work_orders: function(frm) {
		frappe.call({
			method:"erpnext.stock.doctype.material_request.material_request.raise_work_orders",
			args: {
				"material_request": frm.doc.name
			},
			freeze: true,
			callback: function(r) {
				if(r.message.length) {
					frm.reload_doc();
				}
			}
		});
	},
	material_request_type: function(frm) {
		frm.toggle_reqd('customer', frm.doc.material_request_type=="Customer Provided");

		if (frm.doc.material_request_type !== 'Material Transfer' && frm.doc.set_from_warehouse) {
			frm.set_value('set_from_warehouse', '');
		}
	},

});

frappe.ui.form.on("Material Request Item", {
	split: function (frm,cdt,cdn){
		var row = locals[cdt][cdn];
		var _cns = row.split_data || "[]";
		let child_data = JSON.parse(_cns);
		let lst = [];
		child_data.forEach((d) => {
			let qty = parseInt(d.qty)
			let a_qty = parseInt(d.a_qty)
			let r_qty = parseInt(d.r_qty)
			let s_qty = parseInt(d.s_qty)
			lst.push({"cn": d.cn, "qty": qty, "a_qty": a_qty,"r_qty":r_qty,"s_qty":s_qty,"parent":d.parent})
		});
		_cns = lst;
		let dialog = new frappe.ui.Dialog({
			title: __('Allocate Qty CN Wise'),
			fields: [
				{
					fieldtype: 'Data',
					fieldname: 'item',
					 label: __('Item'),
					read_only: 1,
					default: row.item_code + ":" + row.item_name
				},
				{ fieldtype: "Column Break" },
				{
					fieldtype: 'Float',
					fieldname: 'qty',
					label: __('Qty'),
					default: row.required_quantity,
					read_only: 1
				},
				{ fieldtype: "Section Break" },
				{
					fieldname: 'split_data',
					cannot_add_rows: true,
					cannot_delete_rows: true,
					fieldtype: 'Table',
					label: __('CN#'),
					in_editable_grid: true,
					reqd: 1,
					fields: [
					// {
					// 	fieldtype: 'Link',
					// 	fieldname: 'warehouse',
					// 	options: 'Warehouse',
					// 	in_list_view: 1,
					// 	label: __('Warehouse'),
					// 	columns: 4,
					// 	get_query: () => {
					// 		return {
					// 			filters: {
					// 				"is_group": 0
					// 			}
					// 		};
					// 	}
					// }, {
					{
						fieldtype: 'Read Only',
						fieldname: 'cn',
						label: __('CN'),
						in_list_view: 1,
						columns: 2
					}, {
						fieldtype: 'Read Only',
						fieldname: 'qty',
						label: __('Qty'),
						in_list_view: 1,
						columns: 2
					}, {
						fieldtype: 'Float',
						fieldname: 'a_qty',
						label: __('Accpeted Qty'),
						in_list_view: 1,
						reqd: 1,
						default: 0,
						columns: 2
					}, {
						fieldtype: 'Float',
						fieldname: 'r_qty',
						label: __('Rejected Qty'),
						in_list_view: 1,
						reqd: 1,
						default: 0,
						columns: 2
					}, {
						fieldtype: 'Float',
						fieldname: 's_qty',
						label: __('Short Qty'),
						in_list_view: 1,
						reqd: 1,
						default: 0,
						columns: 2
					}, {
						fieldtype: 'Data',
						fieldname: 'parent',
						label: __('Parent'),
						in_list_view: 0,
						reqd: 1
					}],
					data: _cns
				},
			],
			primary_action_label: __('Save'),
			primary_action: function(values) {
				let child_data = values.split_data;
				let a_qty = 0;
				let r_qty = 0;
				let s_qty = 0;
				let lst = []
				child_data.forEach((d) => {
					a_qty += parseInt(d.a_qty);
					r_qty += parseInt(d.r_qty);
					s_qty += parseInt(d.s_qty);
					let total_qty = parseInt(d.qty)
					if (total_qty != (parseInt(d.a_qty) + parseInt(d.r_qty) + parseInt(d.s_qty))){
						frappe.throw('Sum of accepted, rejected and short must be equal to total qty, CN#'+d.cn);
					}
					lst.push({"cn": d.cn, "qty": parseInt(d.qty), "a_qty": parseInt(d.a_qty),"r_qty":parseInt(d.r_qty),"s_qty":parseInt(d.s_qty),"parent":d.parent})
				});
				dialog.hide();
				frappe.model.set_value(cdt,cdn,"split_data",JSON.stringify(lst));
				frappe.model.set_value(cdt,cdn,"qty",a_qty);
				frappe.model.set_value(cdt,cdn,"pack_quantity",r_qty);
				frappe.model.set_value(cdt,cdn,"short_quantity",s_qty);
				frappe.model.set_value(cdt,cdn,"split_wise",1);
				refresh_field("split_data", cdn, "items");
				refresh_field("qty", cdn, "items");
				refresh_field("pack_quantity", cdn, "items");
				refresh_field("short_quantity", cdn, "items");
				refresh_field("split_wise", cdn, "items");
			}
		});
		dialog.show();
	},	

	// qty: function (frm, doctype, name) {
	// 	const item = locals[doctype][name];
	// 	if (flt(item.qty) < flt(item.min_order_qty)) {
	// 		frappe.msgprint(__("Warning: Material Requested Qty is less than Minimum Order Qty"));
	// 	}
	// 	frm.events.get_item_data(frm, item, false);
	// },

	from_warehouse: function(frm, doctype, name) {
		const item = locals[doctype][name];
		frm.events.get_item_data(frm, item, false);
	},

	warehouse: function(frm, doctype, name) {
		const item = locals[doctype][name];
		frm.events.get_item_data(frm, item, false);
	},

	rate: function(frm, doctype, name) {
		const item = locals[doctype][name];
		frm.events.get_item_data(frm, item, false);
	},

	item_code: function(frm, doctype, name) {
		const item = locals[doctype][name];
		item.rate = 0;
		item.uom = '';
		set_schedule_date(frm);
		frm.events.get_item_data(frm, item, true);
	},

	schedule_date: function(frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		if (row.schedule_date) {
			if(!frm.doc.schedule_date) {
				erpnext.utils.copy_value_in_all_rows(frm.doc, cdt, cdn, "items", "schedule_date");
			} else {
				set_schedule_date(frm);
			}
		}
	}
});

erpnext.buying.MaterialRequestController = class MaterialRequestController extends erpnext.buying.BuyingController {
	tc_name() {
		this.get_terms();
	}

	item_code() {
		// to override item code trigger from transaction.js
	}

	validate_company_and_party() {
		return true;
	}

	calculate_taxes_and_totals() {
		return;
	}

	validate() {
		set_schedule_date(this.frm);
	}

	onload(doc, cdt, cdn) {
		this.frm.set_query("item_code", "items", function() {
			if (doc.material_request_type == "Customer Provided") {
				return{
					query: "erpnext.controllers.queries.item_query",
					filters:{
						'customer': me.frm.doc.customer,
						'is_stock_item':1
					}
				}
			} else if (doc.material_request_type == "Purchase") {
				return{
					query: "erpnext.controllers.queries.item_query",
					filters: {'is_purchase_item': 1}
				}
			} else {
				return{
					query: "erpnext.controllers.queries.item_query",
					filters: {'is_stock_item': 1}
				}
			}
		});
	}

	items_add(doc, cdt, cdn) {
		var row = frappe.get_doc(cdt, cdn);
		if(doc.schedule_date) {
			row.schedule_date = doc.schedule_date;
			refresh_field("schedule_date", cdn, "items");
		} else {
			this.frm.script_manager.copy_from_first_row("items", row, ["schedule_date"]);
		}
	}

	items_on_form_rendered() {
		set_schedule_date(this.frm);
	}

	schedule_date() {
		set_schedule_date(this.frm);
	}
};

// for backward compatibility: combine new and previous states
extend_cscript(cur_frm.cscript, new erpnext.buying.MaterialRequestController({frm: cur_frm}));

function set_schedule_date(frm) {
	if(frm.doc.schedule_date){
		erpnext.utils.copy_value_in_all_rows(frm.doc, frm.doc.doctype, frm.doc.name, "items", "schedule_date");
	}
}

function updateChildTable(frm){
	if (frm.doc.type == 'Pick & Pack'){
		frm.doc.naming_series = 'BPL-GDN-.YYYY.-';
		frm.refresh_field('naming_series');
		frm.set_df_property('set_warehouse','reqd',1);
		frm.set_df_property('set_warehouse','hidden',0);
		frm.set_df_property('set_warehouse','label','Packing Location');
		frm.set_df_property('picking_bin','reqd',1);
		frm.set_df_property('picking_bin','hidden',0);

		frm.get_field("items").grid.toggle_reqd("from_warehouse", 1);
		frm.get_field('items').grid.update_docfield_property('from_warehouse','label','Bin');
		frm.get_field('items').grid.toggle_display('required_quantity',1);
		frm.get_field('items').grid.update_docfield_property('required_quantity','label','Required Quantity');
		frm.get_field('items').grid.update_docfield_property('qty','label','Pick Quantity');
		frm.get_field('items').grid.toggle_display('pack_quantity',1);
		frm.get_field('items').grid.update_docfield_property('pack_quantity','label','Pack Quantity');
		frm.get_field('items').grid.toggle_display('short_quantity',0);
		frm.get_field('items').grid.toggle_display('split',0);
		frm.get_field('items').grid.reset_grid();
		frm.set_query("set_warehouse", function(doc){
			return {
				filters: {
					company: doc.company,
					parent_warehouse:['descendants of',doc.custom_location],
					custom_packing_area:1

				}
			};
		});

	}else if(frm.doc.type == 'Put Away GRN'){
		frm.doc.naming_series = 'BPA-GRN-.YYYY.-';
		frm.refresh_field('naming_series');		
		frm.set_df_property('set_warehouse','reqd',0);
		frm.set_df_property('set_warehouse','hidden',1);
		frm.set_df_property('picking_bin','reqd',0);
		frm.set_df_property('picking_bin','hidden',1);
		frm.get_field('items').grid.update_docfield_property('qty','label','Qty');
		frm.get_field('items').grid.toggle_display('required_quantity',0);
		frm.get_field('items').grid.toggle_display('pack_quantity',0);
		frm.get_field("items").grid.toggle_reqd("from_warehouse", 1);
		frm.get_field('items').grid.toggle_display('from_warehouse',1);
		frm.get_field('items').grid.toggle_display('short_quantity',0);
		frm.get_field('items').grid.toggle_display('split',0);
		frm.get_field('items').grid.update_docfield_property('from_warehouse','label','Bin');
		frm.get_field('items').grid.update_docfield_property('qty','read_only',1);
		frm.get_field('items').grid.reset_grid();
	}else if(frm.doc.type == 'Put Away Return'){
		frm.doc.naming_series = 'BPA-RTN-.YYYY.-';
		frm.refresh_field('naming_series');
		frm.set_df_property('picking_bin','reqd',0);
		frm.set_df_property('picking_bin','hidden',1);
		frm.set_df_property('set_warehouse','label','Rejected Location');
		frm.set_df_property('set_warehouse','hidden',0);
		frm.get_field('items').grid.update_docfield_property('required_quantity','label','Total Quantity');
		frm.get_field('items').grid.update_docfield_property('qty','label','Accepted Quantity');
		frm.get_field('items').grid.update_docfield_property('pack_quantity','label','Rejected Quantity');
		frm.get_field('items').grid.update_docfield_property('from_warehouse','label','Bin');
		frm.get_field('items').grid.toggle_display('required_quantity',1);
		frm.get_field('items').grid.toggle_display('short_quantity',1);
		frm.get_field('items').grid.toggle_display('pack_quantity',1);
		frm.get_field("items").grid.toggle_reqd("from_warehouse", 1);
		frm.get_field('items').grid.reset_grid();
		frm.set_query("set_warehouse", function(doc){
			return {
				filters: {
					company: doc.company,
					parent_warehouse:['descendants of',doc.custom_location],
					warehouse_type:'Return'
				}
			};
		});

	}

}

function bulkPrintOption(frm,action){
	if(frm.doc.__islocal == undefined){
		// if(frm.doc.type == 'Pick & Pack' && frm.doc.workflow_state != 'To Pick'){
		if(frm.doc.type == 'Pick & Pack'){
			frm.get_field('items').grid.update_docfield_property('qty','read_only',1);
			frm.add_custom_button(__('Print GDN'), () => frm.events.bulk_print(frm));
			frm.add_custom_button(__('Print Airway Bill'), () => frm.events.bulk_airway_print(frm));
		}else if(frm.doc.type == 'Put Away GRN' && frm.doc.docstatus == 1){
			frm.add_custom_button(__('Print GRN'), () => frm.events.bulk_print(frm));
		}else if(frm.doc.type == 'Put Away Return'){
			frm.add_custom_button(__('Print GDN Return'), () => frm.events.bulk_print(frm));
		}
	}
	
	if(frm.doc.type == 'Pick & Pack'){
		// if (role != undefined && role == 'Warehouse Manager'){
		// 	if(frm.doc.__islocal != undefined){
		// 		frm.get_field('items').grid.update_docfield_property('qty','read_only',1);
		// 		frm.get_field('items').grid.update_docfield_property('pack_quantity','read_only',1);
		// 	}else if(frm.doc.workflow_state == 'To Pick'){
		// 		frm.get_field('items').grid.update_docfield_property('qty','read_only',0);
		// 		frm.get_field('items').grid.update_docfield_property('pack_quantity','read_only',0);
		// 	}else if(frm.doc.workflow_state == 'To Pack'){
		// 		frm.get_field('items').grid.update_docfield_property('qty','read_only',1);
		// 		frm.get_field('items').grid.update_docfield_property('pack_quantity','read_only',0);
		// 	}	
		// }else{
			if(frm.doc.__islocal != undefined){
				frm.get_field('items').grid.update_docfield_property('pack_quantity','read_only',1);
			}else if(frm.doc.workflow_state == 'To Pick' || frm.doc.workflow_state == 'To Pack'){
				frm.get_field('items').grid.update_docfield_property('qty','read_only',1);
				frm.get_field('items').grid.update_docfield_property('pack_quantity','read_only',0);
			}
		// }
	} 
	frm.get_field('items').grid.reset_grid();
	changeButtons(frm)
}

// async function fetchRoleProfile() {
//     try {
//         const response = await frappe.db.get_value('User', frappe.session.user, 'role_profile_name');
//         role = response.message.role_profile_name;
//         // console.log('role 1', role,response);
//         // Call a function or do something else with the role value here
//     } catch (error) {
//         console.error('Error fetching role profile:', error);
//     }
// }

function changeButtons(frm){
	if (frm.doc.type == 'Pick & Pack'){
		if (frm.is_new()){
			frm.add_custom_button(__('GDN'), () => frm.events.get_items_from_sales_order(frm),
			__("Fetch Products"));
			frm.remove_custom_button(__('GRN'),__("Fetch Products"));
			frm.remove_custom_button(__('GDN Return'),__("Fetch Products"));
		}
	}else if(frm.doc.type == 'Put Away GRN'){
		if(frm.is_new()){
			// Button
			frm.add_custom_button(__('GRN'), () => frm.events.get_items_from_grn(frm),
			__("Fetch Products"));
			frm.remove_custom_button(__('GDN'),__("Fetch Products"));
			frm.remove_custom_button(__('GDN Return'),__("Fetch Products"));
		}
	}else if(frm.doc.type == 'Put Away Return'){
		if(frm.is_new()){
			// Button
			frm.add_custom_button(__('GDN Return'), () => frm.events.get_items_from_gdn_return(frm),
			__("Fetch Products"));
			frm.remove_custom_button(__('GRN'),__("Fetch Products"));
			frm.remove_custom_button(__('GDN'),__("Fetch Products"));
		}
	}	
}