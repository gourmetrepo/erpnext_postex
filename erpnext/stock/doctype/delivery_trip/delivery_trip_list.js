frappe.listview_settings['Delivery Trip'] = {
	add_fields: ["status"],
	get_indicator: function (doc) {
		if (in_list(["Cancelled", "Draft"], doc.status)) {
			return [__(doc.status), "red", "status,=," + doc.status];
		} else if (in_list(["In Transit", "Scheduled"], doc.status)) {
			return [__(doc.status), "orange", "status,=," + doc.status];
		} else if (doc.status === "Completed") {
			return [__(doc.status), "green", "status,=," + doc.status];
		}
	},
	onload: function(listview){
		listview.page.add_inner_button(__('PDF'), function() {
			open_url_post('/api/method/erpnext.stock.doctype.delivery_trip.delivery_trip.generate_and_download_pdf',
				{
					'filters' : listview.get_filters_for_args()
				}
			);
		},'Download');		
		listview.page.add_inner_button(__('Excel'), function() {
			open_url_post('/api/method/erpnext.stock.doctype.delivery_trip.delivery_trip.generate_and_download_excel',
				{
					'filters' : listview.get_filters_for_args()
				}
			);
		},'Download');		
	}
};
