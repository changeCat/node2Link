const pageData = JSON.parse(document.getElementById('page-data-requests').textContent);
document.querySelectorAll('[data-request-time]').forEach(function(el){var value=el.dataset.requestTime;if(value){var date=new Date(value);if(!Number.isNaN(date.getTime()))el.textContent=date.toLocaleString()}});
