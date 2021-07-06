# covid19stats-govau

Downloads COVID-19 statistics from the Health NSW QLik servers. Heavily inspired by [jxeeno/aust-govt-covid19-stats](https://github.com/jxeeno/aust-govt-covid19-stats).

This repository:
1. Connect to the NSW Health [QLik Sense API](https://help.qlik.com/en-US/sense-developer/May2021/Subsystems/EngineAPI/Content/Sense_EngineAPI/introducing-engine-API.htm) over WebSockets and downloads data. This raw data is saved to the files ending with `.raw.json`. If you'd like to parse it yourself, a good starting point is the `qDataPages` property.
2. Makes some sort of attempt to make the data more readable. Currently this doesn't work too well, but will be 

**NOTE: Raw data downloads started on the 5th of July 2021. [jxeeno's repository](https://github.com/jxeeno/aust-govt-covid19-stats) has data starting from the 26th of April, but is in a separate format and only has data tables.**

## HTTP access to data

Raw data can be downloaded by making a request in the following format for the date needed.
```
https://www.llui85.cf/covid19stats-govau/data/2021-07-06.raw.json
```

Interpreted data can be downloaded by making a request in the following format for the date needed. **Please note it is recommended that you do not use this data for the time being, as it is buggy and will change in the near future.**
```
https://www.llui85.cf/covid19stats-govau/data/2021-07-06.json
```

## License
All data scraped is from the Australian Government. Code is licensed under the Mozilla Public License 2.0.
