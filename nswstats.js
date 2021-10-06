const fetch = require('node-fetch');
const fs = require('fs');
const moment = require('moment');

const BASE_URL = 'https://nswdac-covid-19-postcode-heatmap.azurewebsites.net/datafiles/';
// js date parsing is a mess...
const CURRENT_DATE = moment().format('YYYY-MM-DD');
const DATA_PATH = './data/nsw';

let datafiles = [
	'active_cases.json',
	'agedata.json',
	'agedata_vaccines.json',
	'fatalitiesdata.json',
	'lga_2019_populations.json',
	'lga_daily_cases.json',
	'lga_daily_tests.json',
	'lga_daily_vaccines.json',
	'population.json',
	'postcode_2019_lga_2020_lists.json',
	'postcode_daily_cases.json',
	'postcode_daily_tests.json',
	'state_vaccination_metrics.json',
	'state_vaccination_metrics_daily.json',
	'stats.json',
	'test_24.json',
	'usecase2.json',
	'vaccination_metrics-v3.json'
];

let requests = datafiles.map(filename => {
	return fetch(BASE_URL + filename);
});

Promise.all(requests).then(responses => {
	return Promise.all(responses.map(response => response.text()));
}).then(data => {
	for (let index in data) {
		let filename = datafiles[index];
		let fileData = data[index];

		let targetFilePath = `${DATA_PATH}/${CURRENT_DATE}-${filename}`;
		fs.writeFileSync(targetFilePath, fileData);
	}
})
