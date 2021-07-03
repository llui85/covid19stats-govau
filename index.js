// initialise dependencies
const WebSocket = require("ws");
// const dateFormat = require("dateformat");
const fetch = require('node-fetch');

// config
const pageUri = "https://www.health.gov.au/news/health-alerts/novel-coronavirus-2019-ncov-health-alert/coronavirus-covid-19-current-situation-and-case-numbers";

// get docId for the 2nd ws connection
async function getDocId(pageUri) {
        return new Promise((resolve) => {
                const referer = encodeURIComponent(pageUri);
                const docListConnection = new WebSocket(`wss://covid19-data.health.gov.au/app/engineData?reloadUri=${referer}`);

                docListConnection.on("open", () => {
                        console.log("Connection to QLik engine established, loading list of documents.");
                });

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
                                console.log(`Using document "${dataDocument.qDocName}", last modified at ${modifiedDate}.`);
                                docListConnection.terminate();
                                resolve(docId);
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
                console.log(`Opening WebSocket for document: ${docId}`)
                const qws = new WebSocket(`wss://covid19-data.health.gov.au/app/${docId}?reloadUri=${referer}`);
                qws.on("open", () => {
                        resolve(qws);
                });
        });
}

let docId = "";
let graphIds = [];

// TODO use anonymous async/awaits here

Promise.all([getDocId(pageUri), getGraphIds(pageUri)]).then(results => {
        docId = results[0];
        graphIds = results[0];
        return docId;
}).then(docId => getWsConnectionForDocId(docId, pageUri)).then(ws => {
        ws.on("message", data => {
                console.log(data);
        });
        ws.send(JSON.stringify({
                delta: true,
                method: "OpenDoc",
                handle: -1,
                params: [docId],
                id: 1,
                jsonrpc: "2.0"
        }));
});

/*
let finalData = {};

const getDocumentById = docId => {
        let requestIndex = 0;
        console.log(`Loading document by ID: ${docId}`)
        const qws = new WebSocket(`wss://covid19-data.health.gov.au/app/${docId}?reloadUri=${referer}`);
        qws.on("open", () => {
                console.log("Connection to QLik established, loading document data.");
        });
        qws.on("message", data => {
                console.log(data);
                data = JSON.parse(data);
                if (requestIndex === 0 && data.method && data.method === "OnConnected") {
                        qws.send(JSON.stringify({
                                delta: true,
                                method: "OpenDoc",
                                handle: -1,
                                params: [
                                        "e8635e3f-b339-4ab3-a9de-b4e3b15c6bbc"
                                ],
                                id: 1,
                                jsonrpc: "2.0"
                        }));
                        requests = 1;
                }
        });
}*/
