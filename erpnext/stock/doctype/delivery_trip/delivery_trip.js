// Copyright (c) 2017, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt
jQuery(document).ready(function($){
	jQuery('buton.grid-add-row').remove();
})
frappe.ui.form.on('Delivery Trip', {
	scan_barcode: function(frm){
		$.each(frm.doc['delivery_stops'] || [], function(i, row) {
			if(row.custom_cn == frm.doc.scan_barcode){
				frappe.throw('Duplicate consignment number not allowed');
			}
		});
		if(frm.doc.delivery_partner == undefined || frm.doc.delivery_partner == ''){
			frappe.call({
				freeze:true,
				method: "erpnext.stock.doctype.delivery_trip.delivery_trip.barcode_deliverycompany",
				args: {
					barcode: frm.doc.scan_barcode
				},
				callback: (data) => {
					if(data.message){
						var childTable = frm.fields_dict['delivery_stops'].grid;
						var newRow = childTable.add_new_row();
						newRow.delivery_note = data.message.name;
						newRow.custom_cn = data.message.custom_cn;
						newRow.custom_consignee = data.message.custom_consignee_name;
						newRow.custom_city = data.message.custom_consignee_city;
						newRow.address = 'Online Customer-Billing';
						childTable.refresh();
						frm.doc.delivery_partner = data.message.sales_partner
						frm.refresh_field('delivery_partner')
					}
				}
			});
		}else{
			frappe.call({
				freeze:true,
				method: "erpnext.stock.doctype.delivery_trip.delivery_trip.barcode",
				args: {
					barcode: frm.doc.scan_barcode,
					delivery_partner : frm.doc.delivery_partner
				},
				callback: (data) => {
					if(data.message){
						var childTable = frm.fields_dict['delivery_stops'].grid;
						var newRow = childTable.add_new_row();
						newRow.delivery_note = data.message.name;
						newRow.custom_cn = data.message.custom_cn;
						newRow.custom_consignee = data.message.custom_consignee_name;
						newRow.custom_city = data.message.custom_consignee_city;
						newRow.address = 'Online Customer-Billing';
						childTable.refresh();
					}
				}
			});
		}

		frm.doc.scan_barcode = '';
		refresh_field('scan_barcode');	
	},
	onload: function(frm) {
		if(frm.is_new()){
			frm.clear_table('delivery_stops');
		}
        frm.set_df_property('departure_time', 'hidden', 1); // Hide the field
        frm.toggle_reqd('departure_time', false); // Make the field mandatory
		// frm.fields_dict['departure_time'].df.default = frappe.datetime.get_today();
		frm.doc.departure_time = frappe.datetime.get_today()
    },
	setup: function (frm) {
		frm.set_indicator_formatter('customer', (stop) => (stop.visited) ? "green" : "orange");
		frm.doc.departure_time = frappe.datetime.now_datetime();
		frm.set_query("driver", function () {
			return {
				filters: {
					"status": "Active"
				}
			};
		});
		frm.set_query("custom_location", function () {
			return {
				filters: {
					"custom_is_main_location": 1,
					"company" : frappe.defaults.get_user_default("Company")
				}
			};
		});

		frm.set_query("address", "delivery_stops", function (doc, cdt, cdn) {
			var row = locals[cdt][cdn];
			if (row.customer) {
				return {
					query: 'frappe.contacts.doctype.address.address.address_query',
					filters: {
						link_doctype: "Customer",
						link_name: row.customer
					}
				};
			}
		})

		frm.set_query("contact", "delivery_stops", function (doc, cdt, cdn) {
			var row = locals[cdt][cdn];
			if (row.customer) {
				return {
					query: 'frappe.contacts.doctype.contact.contact.contact_query',
					filters: {
						link_doctype: "Customer",
						link_name: row.customer
					}
				};
			}
		})
	},

	refresh: function (frm) {

		jQuery('button.grid-add-row').remove();
		// if (frm.doc.docstatus == 1 && frm.doc.delivery_stops.length > 0) {
		// 	frm.add_custom_button(__("Notify Customers via Email"), function () {
		// 		frm.trigger('notify_customers');
		// 	});
		// }

		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(__('Delivery Note'), () => {
				if (frm.doc.delivery_partner == '' || frm.doc.delivery_partner == undefined){
					frappe.throw("Please select the delivery company first");
				}
				let d_stops = [];
				frm.doc.delivery_stops.forEach(item => {
					d_stops.push(item.delivery_note);
				});
				erpnext.utils.map_current_doc({
					method: "erpnext.stock.doctype.delivery_note.delivery_note.make_delivery_trip",
					source_doctype: "Delivery Note",
					target: frm,
					date_field: "posting_date",
					columns:["posting_date","custom_cn","custom_store_order_ref_id"],
					setters: {
						custom_cn: '',
						custom_store_order_ref_id:'',
						// sales_partner:'',
				
					},
					get_query_filters: {
						docstatus: 1,
						company: frm.doc.company,
						sales_partner:frm.doc.delivery_partner,
						name: ["not in",d_stops]
					}
				})
	
			}, __("Fetch Orders"));
		}
		// frm.add_custom_button(__("Delivery Notes"), function () {
		// 	frappe.set_route("List", "Delivery Note",
		// 			{'name': ["in", frm.doc.delivery_stops.map((stop) => {return stop.delivery_note;})]}
		// 	);
		// }, __("View"));
	},

	calculate_arrival_time: function (frm) {
		if (!frm.doc.driver_address) {
			frappe.throw(__("Cannot Calculate Arrival Time as Driver Address is Missing."));
		}
		frappe.show_alert({
			message: "Calculating Arrival Times",
			indicator: 'orange'
		});
		frm.call("process_route", {
			optimize: false,
		}, () => {
			frm.reload_doc();
		});
	},

	driver: function (frm) {
		if (frm.doc.driver) {
			frappe.call({
				method: "erpnext.stock.doctype.delivery_trip.delivery_trip.get_driver_email",
				args: {
					driver: frm.doc.driver
				},
				callback: (data) => {
					frm.set_value("driver_email", data.message.email);
				}
			});
		};
	},

	optimize_route: function (frm) {
		if (!frm.doc.driver_address) {
			frappe.throw(__("Cannot Optimize Route as Driver Address is Missing."));
		}
		frappe.show_alert({
			message: "Optimizing Route",
			indicator: 'orange'
		});
		frm.call("process_route", {
			optimize: true,
		}, () => {
			frm.reload_doc();
		});
	},

	notify_customers: function (frm) {
		$.each(frm.doc.delivery_stops || [], function (i, delivery_stop) {
			if (!delivery_stop.delivery_note) {
				frappe.msgprint({
					"message": __("No Delivery Note selected for Customer {}", [delivery_stop.customer]),
					"title": __("Warning"),
					"indicator": "orange",
					"alert": 1
				});
			}
		});

		frappe.db.get_value("Delivery Settings", { name: "Delivery Settings" }, "dispatch_template", (r) => {
			if (!r.dispatch_template) {
				frappe.throw(__("Missing email template for dispatch. Please set one in Delivery Settings."));
			} else {
				frappe.confirm(__("Do you want to notify all the customers by email?"), function () {
					frappe.call({
						method: "erpnext.stock.doctype.delivery_trip.delivery_trip.notify_customers",
						args: {
							"delivery_trip": frm.doc.name
						},
						callback: function (r) {
							if (!r.exc) {
								frm.doc.email_notification_sent = true;
								frm.refresh_field('email_notification_sent');
							}
						}
					});
				});
			}
		});
	}
});

frappe.ui.form.on('Delivery Stop', {
	customer: function (frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		if (row.customer) {
			frappe.call({
				method: "erpnext.stock.doctype.delivery_trip.delivery_trip.get_contact_and_address",
				args: { "name": row.customer },
				callback: function (r) {
					if (r.message) {
						if (r.message["shipping_address"]) {
							frappe.model.set_value(cdt, cdn, "address", r.message["shipping_address"].parent);
						}
						else {
							frappe.model.set_value(cdt, cdn, "address", '');
						}
						if (r.message["contact_person"]) {
							frappe.model.set_value(cdt, cdn, "contact", r.message["contact_person"].parent);
						}
						else {
							frappe.model.set_value(cdt, cdn, "contact", '');
						}
					}
					else {
						frappe.model.set_value(cdt, cdn, "address", '');
						frappe.model.set_value(cdt, cdn, "contact", '');
					}
				}
			});
		}
	},

	address: function (frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		if (row.address) {
			frappe.call({
				method: "frappe.contacts.doctype.address.address.get_address_display",
				args: { "address_dict": row.address },
				callback: function (r) {
					if (r.message) {
						frappe.model.set_value(cdt, cdn, "customer_address", r.message);
					}
				}
			});
		} else {
			frappe.model.set_value(cdt, cdn, "customer_address", "");
		}
	},

	contact: function (frm, cdt, cdn) {
		var row = locals[cdt][cdn];
		if (row.contact) {
			frappe.call({
				method: "erpnext.stock.doctype.delivery_trip.delivery_trip.get_contact_display",
				args: { "contact": row.contact },
				callback: function (r) {
					if (r.message) {
						frappe.model.set_value(cdt, cdn, "customer_contact", r.message);
					}
				}
			});
		} else {
			frappe.model.set_value(cdt, cdn, "customer_contact", "");
		}
	}
});
