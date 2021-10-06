const WebSocket = require("ws");
const fetch = require("node-fetch");
const moment = require('moment');
const fs = require("fs");

// config
const pageUri = "https://www.health.gov.au/news/health-alerts/novel-coronavirus-2019-ncov-health-alert/coronavirus-covid-19-current-situation-and-case-numbers";
// maps the graphIds to a machine-readable title:
const graphIdMapping = {
        "YfhJjRW": "locally-acquired-last-24-hours", // self-explanatory, single number
        "jJWJXQs": "overseas-acquired-last-24-hours", // self-explanatory, single number
        "JEjLq": "under-investigation-last-24-hours", // self-explanatory, single number
        "pArYV": "currently-active-cases", // self-explanatory, single number
        "QvUrm": "currently-hospitalised", // self-explanatory, single number
        "kwfnAur": "tests-last-24-hours", // self-explanatory, single number
        "pJfAWJv": "total-cases", // self-explanatory, single number
        "ykJhGRM": "total-deaths", // self-explanatory, single number
        "HuCJf": "total-tests", // self-explanatory, single number
        "KdmpZ": "cases-by-jurisdiction", // currently (active cases) + (local, overseas, under investigation)(for last hours, for last 7 days), all filtered by state
        "jcGTs": "daily-and-cumulative-au", // daily historical numbers for australia with cumulative count
        "gjjZnj": "total-cases-by-jurisdiction", //
        "CMLjmx": "total-cases-by-age-group-sex",
        "PSWhPA": "total-cases-by-age-group-sex-table",
        "kJKhDk": "total-deaths-by-age-group-sex",
        "uJauhW": "total-deaths-by-age-group-sex-table",
        "zfDpnUy": "tests-in-last-7-days-total",
        "ybCdZWz": "cases-admitted-to-hospital",
        "GJSFMHS": "cases-admitted-to-hospital-table",
        "vpCstLd": "cases-aged-care",
        "SfYPx": "cases-aged-care-table",
        "ECq": "cases-home-care",
        "aVJJAHx": "cases-home-care-table",
}

// get docId for the 2nd ws connection
async function getDocId(pageUri) {
        return new Promise((resolve) => {
                const referer = encodeURIComponent(pageUri);
                const docListConnection = new WebSocket(`wss://covid19-data.health.gov.au/app/engineData?reloadUri=${referer}`);

                docListConnection.on("message", data => {
                        data = JSON.parse(data);
                        // wait until connection established, then send initial request
                        if (data.method && data.method === "OnConnected") {
                                docListConnection.send(JSON.stringify({
                                        delta: true,
                                        method: "GetDocList",
                                        handle: -1,
                                        params: [],
                                        id: 1,
                                        jsonrpc: "2.0"
                                }));
                        }
                        if (data.result) {
                                let dataDocument = data.result.qDocList[0].value[0];
                                let modifiedDate = dataDocument.qMeta.modifiedDate;
                                let docId = dataDocument.qDocId;
                                docListConnection.terminate();
                                resolve([docId, modifiedDate]);
                        }
                });
        });
}

// scrape the page for the graph ids
async function getGraphIds(pageUri) {
        return new Promise((resolve, reject) => {
                fetch(pageUri).then(response => response.text()).then(html => {
                        // extract the config from the page
                        let graphIdRegex = /{"qlik_components":(\[({"component_id":"\w{1,10}"},?)*\])/;
                        let match = graphIdRegex.exec(html);
                        let graphIds = match[1];

                        // parse to json, and filter out the object to just an array
                        graphIds = JSON.parse(graphIds);
                        graphIds = graphIds.map(item => item["component_id"]);
                        resolve(graphIds);
                });
        });
}

async function getWsConnectionForDocId(docId, pageUri) {
        return new Promise((resolve, reject) => {
                const referer = encodeURIComponent(pageUri);
                const qws = new WebSocket(`wss://covid19-data.health.gov.au/app/${docId}?reloadUri=${referer}`);
                qws.on("open", () => {
                        resolve(qws);
                });
        });
}

function getKPIData(graphObject) {
        let graphId = graphObject.qInfo.qId;
        let graphData = graphObject.qHyperCube.qGrandTotalRow[0].qNum;
        let graphTitle = graphObject.qHyperCube.qMeasureInfo[0].qFallbackTitle;
        return {
                graphId: graphId,
                type: "kpi",
                title: graphTitle,
                data: graphData
        }
}

// get data as a matrix (mainly useful tables), e.g:
// [["State", "Cases", "Deaths"]],
// [[ "NSW" ,   244  ,    2    ]],
// [[ "QLD" ,   123  ,    1    ]]
function getMatrixData(graphObject) {
        let graphId = graphObject.qInfo.qId;
        let graphTitle = "Unknown";

        let dimensions = graphObject.qHyperCube.qDimensionInfo.map(item => {
                return item.qFallbackTitle;
        })
        let measures = graphObject.qHyperCube.qMeasureInfo.map(item => {
                return item.qFallbackTitle;
        });
        let header = [...dimensions, ...measures]
        let data = graphObject.qHyperCube.qDataPages[0].qMatrix.map(row => {
                return row.map(datapoint => {
                        if (isNaN(datapoint.qNum)) {
                                return datapoint.qText;
                        } else {
                                return datapoint.qNum.toString();
                        }
                });
        });

        return {
                graphId: graphId,
                type: "matrix",
                title: graphTitle,
                data: {
                        header: header,
                        body: data,
                        data: [header, ...data]
                }
        }
}

// get matrix data, then categorise it according to the dimension (x-axis)
// {
//         "NSW": {
//                 "Cases": 244,
//                 "Deaths": 2
//         },
//         "QLD": {
//                 "Cases": 123,
//                 "Deaths": 1
//         }
// }
function getMatrixDataCategorised(graphObject, preferTextDimensions = false) {
        let graphId = graphObject.qInfo.qId;
        let graphTitle = "Unknown";

        // x axis - only 1
        let dimensions = graphObject.qHyperCube.qDimensionInfo.map(item => {
                return {
                        label: item.qFallbackTitle,
                        type: "dimension"
                };
        });
        // y axis - there may be many of these
        let measures = graphObject.qHyperCube.qMeasureInfo.map(item => {
                return {
                        label: item.qFallbackTitle,
                        type: "measure"
                };
        });
        let labels = [...dimensions, ...measures];
        let graphData = {};
        for (row of graphObject.qHyperCube.qDataPages[0].qMatrix) {
                // if (debug) console.log(row);
                let rowDimension = "";
                for (datapointIndex in row) {
                        let datapoint = row[datapointIndex];
                        let label = labels[datapointIndex];
                        if (label.type === "dimension") {
                                if (preferTextDimensions) {
                                        rowDimension = datapoint.qText;
                                } else {
                                        rowDimension = isNaN(datapoint.qNum) ? datapoint.qText : datapoint.qNum;
                                }
                                if (debug) console.log("dimension to " + rowDimension);
                        }
                        if (typeof graphData[rowDimension] === "undefined") {
                                graphData[rowDimension] = {};
                        }
                        if (label.type === "measure") {
                                if (isNaN(datapoint.qNum)) {
                                        graphData[rowDimension][label.label] = datapoint.qText;
                                } else {
                                        graphData[rowDimension][label.label] = datapoint.qNum;
                                }
                        }
                }
        }

        return {
                graphId: graphId,
                type: "matrixCategorised",
                title: graphTitle,
                data: {
                        data: graphData
                }
        }
}

function getMatrixDataCategorisedByKey(graphObject, preferTextDimensions = false) {
        let graphId = graphObject.qInfo.qId;
        let graphTitle = "Unknown";

        // x axis - only 1
        let dimensions = graphObject.qHyperCube.qDimensionInfo.map(item => {
                return {
                        label: item.qFallbackTitle,
                        type: "dimension"
                };
        });
        // y axis - there may be multiple of these
        let measures = graphObject.qHyperCube.qMeasureInfo.map(item => {
                return {
                        label: item.qFallbackTitle,
                        type: "measure"
                };
        });
        let labels = [...dimensions, ...measures];
        let graphMatrix = graphObject.qHyperCube.qDataPages[0].qMatrix;
        let graphData = {};

        for (let measureIndex = 0; measureIndex < measures.length; measureIndex++) {
                let measure = measures[measureIndex];
                let labelIndex = dimensions.length + measureIndex;
                if (typeof graphData[measure.label] === "undefined") {
                        graphData[measure.label] = {};
                }
                for (let rowIndex = 0; rowIndex < graphMatrix.length; rowIndex++) {
                        let datapoint = graphMatrix[rowIndex][labelIndex];
                        let dimension = graphMatrix[rowIndex][0];
                        if (preferTextDimensions || isNaN(dimension.qNum)) {
                                dimension = dimension.qText;
                        } else {
                                dimension = dimension.qNum;
                        }
                        if (isNaN(datapoint.qNum)) {
                                graphData[measure.label][dimension] = datapoint.qText;
                        } else {
                                graphData[measure.label][dimension] = datapoint.qNum;
                        }
                }
        }

        return {
                graphId: graphId,
                type: "matrixCategorisedByKey",
                title: graphTitle,
                data: {
                        data: graphData
                }
        }
}

function getBarChartData(graphObject) {
        let graphId = graphObject.qInfo.qId;
        let graphTitle = "Unknown";

        let graphData = {};
        for (element of graphObject.qHyperCube.qDataPages[0].qMatrix) {
                let bin = isNaN(element[0].qNum) ? element[0].qText : element[0].qNum;
                let category = isNaN(element[1].qNum) ? element[1].qText : element[1].qNum;
                let value = isNaN(element[2].qNum) ? element[2].qText : element[2].qNum;
                if (typeof graphData[bin] === "undefined") {
                        graphData[bin] = {};
                }
                graphData[bin][category] = value;
        }

        return {
                graphId: graphId,
                type: "barchart",
                title: graphTitle,
                data: graphData
        }
}

let docId = "";
let docDate = "";
let graphIds = [];

Promise.all([getDocId(pageUri), getGraphIds(pageUri)]).then(results => {
        docId = results[0][0];
        docDate = results[0][1];
        graphIds = results[1];
        return docId;
})
.then(docId => getWsConnectionForDocId(docId, pageUri))
.then(ws => new Promise((resolve, reject) => {
        ws.on("message", data => {
                data = JSON.parse(data);
                if (data.result && data.result.qReturn) {
                        resolve([data.id, ws]);
                }
        });
        ws.send(JSON.stringify({
                delta: true,
                method: "OpenDoc",
                handle: -1,
                params: [docId],
                id: 1,
                jsonrpc: "2.0"
        }));
})).then(results => new Promise((resolve, reject) => {
        let handleId = results[0];
        let ws = results[1];
        let graphs = [];
        let requestIndex = 1;

        ws.removeAllListeners("message");
        ws.on("message", data => {
                data = JSON.parse(data);
                if (data.result && data.result.qReturn) {
                        let graph = {};
                        graph.handleId = data.id;
                        graph.id = data.result.qReturn[0].value.qGenericId;
                        graph.type = data.result.qReturn[0].value.qGenericType;
                        graphs.push(graph);
                        if (graphs.length === graphIds.length) {
                                resolve([ws, graphs, requestIndex]);
                        }
                }
        });
        for (graphId of graphIds) {
                ws.send(JSON.stringify({
                        delta: true,
                        method: "GetObject",
                        handle: handleId,
                        params: [graphId],
                        jsonrpc: "2.0",
                        id: (requestIndex++, requestIndex)
                }));
        }
})).then(results => new Promise((resolve, reject) => {
        let ws = results[0];
        let graphs = results[1];
        let requestIndex = results[2];

        let finalData = [];
        let rawData = [];

        ws.removeAllListeners("message");
        ws.on("message", data => {
                data = JSON.parse(data);
                let graphObject = data.result.qLayout[0].value;
                let graphId = graphObject.qInfo.qId;
                let graphType = graphObject.qInfo.qType;
                let graphData;
                if (graphType === "kpi") {
                        graphData = getKPIData(graphObject);
                } else if (graphType === "table") {
                        graphData = getMatrixData(graphObject);
                } else if (graphType === "widget") {
                        let widgetType = graphObject.widgetMeta.name;
                        if (widgetType === "KPI2") {
                                graphData = getKPIData(graphObject);
                        } else if (widgetType === "CustomizedSimpleTable") {
                                graphData = getMatrixData(graphObject);
                        } else {
                                graphData = {
                                        graphId: "null",
                                        type: "unknown",
                                        title: `Error - unknown widget type "${widgetType}" - skipped`,
                                        data: null
                                }
                                console.log(`Error - unknown widget type "${widgetType}" - skipped`);
                        }
                } else if (graphType === "barchart" || graphType === "qlik-barplus-chart") {
                        graphData = getMatrixDataCategorisedByKey(graphObject);
                } else if (graphType === "combochart") {
                        graphData = getMatrixDataCategorisedByKey(graphObject, true);
                } else {
                        graphData = {
                                graphId: "null",
                                type: "unknown",
                                title: `Error - unknown graph type "${graphType}" - skipped`,
                                data: null
                        }
                        console.log(`Error - unknown graph type "${graphType}" - skipped`);
                }
                let graphName = graphIdMapping[graphId];
                graphData.graphId = graphId;
                graphData.name = graphName;
                finalData.push(graphData);
                rawData.push(graphObject);

                if (finalData.length === graphIds.length) {
                        ws.terminate();

                        let formattedDate = moment(docDate).format('YYYY-MM-DD');

                        fs.writeFileSync(`data/federal/${formattedDate}.json`, JSON.stringify(finalData));
                        fs.writeFileSync(`data/federal/${formattedDate}.raw.json`, JSON.stringify(rawData));

                        process.exit();
                }
        });

        for (graph of graphs) {
                ws.send(JSON.stringify({
                        delta: true,
                        method: "GetLayout",
                        handle: graph.handleId,
                        params: [],
                        jsonrpc: "2.0",
                        id: (requestIndex++, requestIndex)
                }));
        }
}));
