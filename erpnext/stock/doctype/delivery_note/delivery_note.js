// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// License: GNU General Public License v3. See license.txt

{% include 'erpnext/selling/sales_common.js' %};

cur_frm.add_fetch('customer', 'tax_id', 'tax_id');

frappe.provide("erpnext.stock");
frappe.provide("erpnext.stock.delivery_note");
frappe.provide("erpnext.accounts.dimensions");
let currentState = '';
frappe.ui.form.on("Delivery Note", {
	custom_barcode: function(frm){
		if (frm.doc.custom_barcode != ''){
			frappe.call({
				method: "postex.api.dn.get_item_by_barcode",
				type: "GET",
				args: {
					"barcode":frm.doc.custom_barcode
				},
				callback: function (r) {
					var item_code = r.message;
					frm.doc.items.forEach(function(d){
						if (d.item_code == item_code){
							if(d.qty < (d.pack_quantity + 1)){
								frappe.throw("You cannot add item more then pick quantity");
							}
							d.pack_quantity += 1;
							frm.refresh_field('items');
							frm.doc.custom_barcode = '';
							frm.refresh_field('custom_barcode');
						}
					});
				},
			});		
		}

	},
	setup: function(frm) {
		frm.set_df_property('items', 'cannot_add_rows', true);
		frm.set_df_property('items', 'multiple_rows', false);
		frm.set_df_property('items', 'cannot_delete_rows', true);
		frm.custom_make_buttons = {
			'Packing Slip': 'Packing Slip',
			'Installation Note': 'Installation Note',
			'Sales Invoice': 'Sales Invoice',
			'Stock Entry': 'Return',
			'Shipment': 'Shipment'
		},
		frm.set_indicator_formatter('item_code',
			function(doc) {
				return (doc.docstatus==1 || doc.qty<=doc.actual_qty) ? "green" : "orange"
			})

		erpnext.queries.setup_queries(frm, "Warehouse", function() {
			return erpnext.queries.warehouse(frm.doc);
		});
		erpnext.queries.setup_warehouse_query(frm);

		frm.set_query('project', function(doc) {
			return {
				query: "erpnext.controllers.queries.get_project_name",
				filters: {
					'customer': doc.customer
				}
			}
		})

		frm.set_query('transporter', function() {
			return {
				filters: {
					'is_transporter': 1
				}
			}
		});

		frm.set_query('driver', function(doc) {
			return {
				filters: {
					'transporter': doc.transporter
				}
			}
		});


		frm.set_query('expense_account', 'items', function(doc, cdt, cdn) {
			if (erpnext.is_perpetual_inventory_enabled(doc.company)) {
				return {
					filters: {
						"report_type": "Profit and Loss",
						"company": doc.company,
						"is_group": 0
					}
				}
			}
		});

		frm.set_query('cost_center', 'items', function(doc, cdt, cdn) {
			if (erpnext.is_perpetual_inventory_enabled(doc.company)) {
				return {
					filters: {
						'company': doc.company,
						"is_group": 0
					}
				}
			}
		});
		frm.set_query("warehouse", "items", function(doc, cdt, cdn) {
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

		frm.set_df_property('packed_items', 'cannot_add_rows', true);
		frm.set_df_property('packed_items', 'cannot_delete_rows', true);
	},

	print_without_amount: function(frm) {
		erpnext.stock.delivery_note.set_print_hide(frm.doc);
	},
	custom_picking_bin: function(frm){
		frappe.db.set_value('Picking Bin',frm.doc.custom_picking_bin,'occupied',1);
	},
	onload: function(frm){
		jQuery('button.grid-add-multiple-rows').remove();
		if (frm.doc.docstatus == 0 && !frm.is_new() && (frm.doc.custom_picking_bin == undefined || frm.doc.custom_picking_bin == '')){
			frm.set_df_property('custom_picking_bin','reqd',true);
			frm.doc.custom_picking_bin = '';
			frm.refresh_field('custom_picking_bin');
			frm.dirty();
			jQuery('button.actions-btn-group').hide();
			frm.enable_save();
		}
		if (currentState == ''){
			currentState = frm.doc.workflow_state;
		}
		if (currentState == 'To Pick' && frm.doc.workflow_state == 'To Pack'){
			frappe.set_route('List', 'Delivery Note');
		}

		if (currentState != frm.doc.workflow_state){
			var msg = '';
			if (frm.doc.workflow_state == 'To Pick'){
				msg = 'picked';
			}else if(frm.doc.workflow_state == 'To Pack'){
				msg = 'packed';
			}
			if(msg != ''){
				frappe.toast({
					message: __('Sales order is {0} successfully.', [msg]),
					seconds: 10,
					indicator:'green'
				});
			}
			currentState = frm.doc.workflow_state;
		}

	},
	// after_save: function(frm){
	// },
	custom_print_airway_bill: function(frm){
		window.open(frm.doc.custom_airway_bill);
	},
	refresh: function(frm) {
		// frm.fields_dict.workflow_state.$input.on('change', function() {
        //     var currentWorkflowState = frm.doc.workflow_state; 
        //     // Check if the workflow state is the one you are interested in
        //     // if (currentWorkflowState === 'YourTargetWorkflowState') {
        //         // Show a notification
        //         frappe.toast({
        //             message: __('GDN state changed to {0}', [currentWorkflowState]),
        //             seconds: 10,
		// 			indicator:'green'
        //         });
        //     // }
        // });		
		frm.set_df_property('items', 'multiple_rows', false);
		if (frm.doc.docstatus == 0 && !frm.is_new() && (frm.doc.custom_picking_bin == undefined || frm.doc.custom_picking_bin == '')){
			frm.set_df_property('custom_picking_bin','reqd',true);
			frm.doc.custom_picking_bin = '';
			frm.refresh_field('custom_picking_bin');
			frm.dirty();
			jQuery('button.actions-btn-group').hide();
			jQuery('button.grid-add-multiple-rows').remove();
			frm.enable_save();
			frm.freeze = true;
			frm.doc.items.forEach(function(item){
				frappe.call({
					method: "frappe.client.get_value",
					args: {
						doctype: "Warehouse",
						filters: { "name": item.warehouse},
						fieldname: ["custom_is_pickable_bin"]
					},
					callback: function(response) {
						// Check if the call was successful
						if (!response.exc && response.message) {
							var is_pickable = response.message.custom_is_pickable_bin;
							if (is_pickable == 0){
								item.warehouse = '';
							}
						}
					}
				});
			});
			frm.refresh_field('items')
			frm.freeze = false;

		}
		frm.set_df_property('delivery_note_item', 'cannot_add_rows', true);
		frm.set_df_property('delivery_note_item', 'cannot_delete_rows', true);
		// frm.fields_dict['delivery_note_item'].grid.only_sortable();
		frm.set_query('custom_picking_bin', function() {
			return {
				filters: {
					'occupied': 0
				}
			}
		});
		frm.set_query('accepted_warehouse', function() {
			return {
				filters: {
					'warehouse_type': 'Return'
				}
			}
		});
		frm.set_query('returned_warehouse', function() {
			return {
				filters: {
					'warehouse_type': 'Rejection'
				}
			}
		});
		frm.set_query("warehouse", "items", function(doc, cdt, cdn) {
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
		if (frm.doc.docstatus === 1 && frm.doc.is_return === 1 && frm.doc.per_billed !== 100) {
			// frm.add_custom_button(__('Credit Note'), function() {
				// frappe.model.open_mapped_doc({
					// method: "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice",
					// frm: cur_frm,
				// })
			// }, __('Create'));
			// frm.page.set_inner_btn_group_as_primary(__('Create'));
		}

		if (frm.doc.docstatus == 1 && !frm.doc.inter_company_reference) {
			let internal = frm.doc.is_internal_customer;
			if (internal) {
				let button_label = (frm.doc.company === frm.doc.represents_company) ? "Internal Purchase Receipt" :
					"Inter Company Purchase Receipt";

				frm.add_custom_button(__(button_label), function() {
					frappe.model.open_mapped_doc({
						method: 'erpnext.stock.doctype.delivery_note.delivery_note.make_inter_company_purchase_receipt',
						frm: frm,
					});
				}, __('Create'));
			}
		}
	}
});

frappe.ui.form.on("Delivery Note Item", {
	expense_account: function(frm, dt, dn) {
		var d = locals[dt][dn];
		frm.update_in_all_rows('items', 'expense_account', d.expense_account);
	},
	cost_center: function(frm, dt, dn) {
		var d = locals[dt][dn];
		frm.update_in_all_rows('items', 'cost_center', d.cost_center);
	}
});

erpnext.stock.DeliveryNoteController = class DeliveryNoteController extends erpnext.selling.SellingController {
	setup(doc) {
		this.setup_posting_date_time_check();
		super.setup(doc);
		this.frm.make_methods = {
			'Delivery Trip': this.make_delivery_trip,
		};
	}
	refresh(doc, dt, dn) {
		var me = this;
		super.refresh();
		if ((!doc.is_return) && (doc.status!="Closed" || this.frm.is_new())) {
			// if (this.frm.doc.docstatus===0) {
				// this.frm.add_custom_button(__('Sales Order'),
					// function() {
						// if (!me.frm.doc.customer) {
							// frappe.throw({
								// title: __("Mandatory"),
								// message: __("Please Select a Customer")
							// });
						// }
						// erpnext.utils.map_current_doc({
							// method: "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note",
							// source_doctype: "Sales Order",
							// target: me.frm,
							// setters: {
								// customer: me.frm.doc.customer,
							// },
							// get_query_filters: {
								// docstatus: 1,
								// status: ["not in", ["Closed", "On Hold"]],
								// per_delivered: ["<", 99.99],
								// company: me.frm.doc.company,
								// project: me.frm.doc.project || undefined,
							// }
						// })
					// }, __("Get Items From"));
			// }
		}
		if (this.frm.is_new() && (this.frm.doc.return_date == undefined || this.frm.doc.return_date == '')){
			this.frm.doc.return_date = frappe.datetime.now_datetime();
		}
		refresh_field('return_date');
		this.frm.get_field("items").grid.toggle_enable("qty", (this.frm.doc.workflow_state == 'To Pick') ? 1 : 0);
		this.frm.get_field("items").grid.toggle_enable("pack_quantity", (this.frm.doc.workflow_state == 'To Pack') ? 1 : 0);
		refresh_field("items");
		this.frm.get_field("delivery_note_item").grid.toggle_enable("accepted_quantity", (this.frm.doc.workflow_state == 'To QC') ? 1 : 0);
		this.frm.get_field("delivery_note_item").grid.toggle_enable("rejected_quantity", (this.frm.doc.workflow_state == 'To QC') ? 1 : 0);
		this.frm.get_field("delivery_note_item").grid.toggle_enable("short_quantity", (this.frm.doc.workflow_state == 'To QC') ? 1 : 0);
		refresh_field('delivery_note_item')
		if (!doc.is_return && doc.status!="Closed") {
			// if(doc.docstatus == 1) {
				// this.frm.add_custom_button(__('Shipment'), function() {
					// me.make_shipment() }, __('Create'));
			// }

			// if(flt(doc.per_installed, 2) < 100 && doc.docstatus==1)
				// this.frm.add_custom_button(__('Installation Note'), function() {
					// me.make_installation_note() }, __('Create'));

			if (doc.docstatus==1 && doc.custom_auto_return == 0) {
				this.frm.add_custom_button(__('Sales Return'), function() {
					me.make_sales_return() }, __('Create'));
			}

			// if (doc.docstatus==1) {
				// this.frm.add_custom_button(__('Delivery Trip'), function() {
					// me.make_delivery_trip() }, __('Create'));
			// }

			if(doc.docstatus==0 && !doc.__islocal) {
				if (doc.__onload && doc.__onload.has_unpacked_items) {
					// this.frm.add_custom_button(__('Packing Slip'), function() {
					// 	frappe.model.open_mapped_doc({
					// 		method: "erpnext.stock.doctype.delivery_note.delivery_note.make_packing_slip",
					// 		frm: me.frm
					// 	}) }, __('Create')
					// );
				}
			}

			if (!doc.__islocal && doc.docstatus==1 && doc.custom_auto_return == 0) {
				this.frm.page.set_inner_btn_group_as_primary(__('Create'));
			}
		}

		if (doc.docstatus > 0) {
			this.show_stock_ledger();
			// if (erpnext.is_perpetual_inventory_enabled(doc.company)) {
				// this.show_general_ledger();
			// }
			if (this.frm.has_perm("submit") && doc.status !== "Closed") {
				me.frm.add_custom_button(__("Close"), function() { me.close_delivery_note() },
					__("Status"))
			}
		}

		if(doc.docstatus==1 && !doc.is_return && doc.status!="Closed" && flt(doc.per_billed) < 100) {
			// show Make Invoice button only if Delivery Note is not created from Sales Invoice
			var from_sales_invoice = false;
			from_sales_invoice = me.frm.doc.items.some(function(item) {
				return item.against_sales_invoice ? true : false;
			});

			// if(!from_sales_invoice) {
				// this.frm.add_custom_button(__('Sales Invoice'), function() { me.make_sales_invoice() },
					// __('Create'));
			// }
		}

		if(doc.docstatus==1 && doc.status === "Closed" && this.frm.has_perm("submit")) {
			this.frm.add_custom_button(__('Reopen'), function() { me.reopen_delivery_note() },
				__("Status"))
		}
		erpnext.stock.delivery_note.set_print_hide(doc, dt, dn);

		// if(doc.docstatus==1 && !doc.is_return && !doc.auto_repeat) {
			// cur_frm.add_custom_button(__('Subscription'), function() {
				// erpnext.utils.make_subscription(doc.doctype, doc.name)
			// }, __('Create'))
		// }
	}

	make_shipment() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.delivery_note.delivery_note.make_shipment",
			frm: this.frm
		})
	}

	make_sales_invoice() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice",
			frm: this.frm
		})
	}

	make_installation_note() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.delivery_note.delivery_note.make_installation_note",
			frm: this.frm
		});
	}

	make_sales_return() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_return",
			frm: this.frm
		})
	}

	make_delivery_trip() {
		frappe.model.open_mapped_doc({
			method: "erpnext.stock.doctype.delivery_note.delivery_note.make_delivery_trip",
			frm: cur_frm
		})
	}

	tc_name() {
		this.get_terms();
	}

	items_on_form_rendered(doc, grid_row) {
		erpnext.setup_serial_or_batch_no();
	}

	packed_items_on_form_rendered(doc, grid_row) {
		erpnext.setup_serial_or_batch_no();
	}

	close_delivery_note(doc){
		this.update_status("Closed")
	}

	reopen_delivery_note() {
		this.update_status("Submitted")
	}

	update_status(status) {
		var me = this;
		frappe.ui.form.is_saving = true;
		frappe.call({
			method:"erpnext.stock.doctype.delivery_note.delivery_note.update_delivery_note_status",
			args: {docname: me.frm.doc.name, status: status},
			callback: function(r){
				if(!r.exc)
					me.frm.reload_doc();
			},
			always: function(){
				frappe.ui.form.is_saving = false;
			}
		})
	}
};

extend_cscript(cur_frm.cscript, new erpnext.stock.DeliveryNoteController({frm: cur_frm}));

frappe.ui.form.on('Delivery Note', {
	setup: function(frm) {
		if(frm.doc.company) {
			frm.trigger("unhide_account_head");
		}
	},

	company: function(frm) {
		frm.trigger("unhide_account_head");
		erpnext.accounts.dimensions.update_dimension(frm, frm.doctype);
	},

	unhide_account_head: function(frm) {
		// unhide expense_account and cost_center if perpetual inventory is enabled in the company
		var aii_enabled = erpnext.is_perpetual_inventory_enabled(frm.doc.company)
		frm.fields_dict["items"].grid.set_column_disp(["expense_account", "cost_center"], aii_enabled);
	}
})


erpnext.stock.delivery_note.set_print_hide = function(doc, cdt, cdn){
	var dn_fields = frappe.meta.docfield_map['Delivery Note'];
	var dn_item_fields = frappe.meta.docfield_map['Delivery Note Item'];
	var dn_fields_copy = dn_fields;
	var dn_item_fields_copy = dn_item_fields;
	if (doc.print_without_amount) {
		dn_fields['currency'].print_hide = 1;
		dn_item_fields['rate'].print_hide = 1;
		dn_item_fields['discount_percentage'].print_hide = 1;
		dn_item_fields['price_list_rate'].print_hide = 1;
		dn_item_fields['amount'].print_hide = 1;
		dn_item_fields['discount_amount'].print_hide = 1;
		dn_fields['taxes'].print_hide = 1;
	} else {
		if (dn_fields_copy['currency'].print_hide != 1)
			dn_fields['currency'].print_hide = 0;
		if (dn_item_fields_copy['rate'].print_hide != 1)
			dn_item_fields['rate'].print_hide = 0;
		if (dn_item_fields_copy['amount'].print_hide != 1)
			dn_item_fields['amount'].print_hide = 0;
		if (dn_item_fields_copy['discount_amount'].print_hide != 1)
			dn_item_fields['discount_amount'].print_hide = 0;
		if (dn_fields_copy['taxes'].print_hide != 1)
			dn_fields['taxes'].print_hide = 0;
	}
}


frappe.tour['Delivery Note'] = [
	{
		fieldname: "customer",
		title: __("Customer"),
		description: __("This field is used to set the 'Customer'.")
	},
	{
		fieldname: "items",
		title: __("Items"),
		description: __("This table is used to set details about the 'Item', 'Qty', 'Basic Rate', etc.") + " " +
		__("Different 'Source Warehouse' and 'Target Warehouse' can be set for each row.")
	},
	{
		fieldname: "set_posting_time",
		title: __("Edit Posting Date and Time"),
		description: __("This option can be checked to edit the 'Posting Date' and 'Posting Time' fields.")
	}
]
