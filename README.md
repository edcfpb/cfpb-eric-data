## Eric's CFPB Data Engineer assignment

**Instructions:**

- Install [NodeJS](https://nodejs.org/en/download/)
- Clone this repo
- Open a command/shell prompt and go in to this project/repo directory
- Run `npm install` or `yarn install` if you have yarn
- Everything should run automatically post install
- If you need to manually start, run `npm start` or `gulp start` to start kick off the process and start the web server
- Use your web browser to access http://localhost:6789/ which will show you the visualization I created, as well as provide a download link for the final CSV output file


**Assumptions:**

- Several of the columns to be aggregated had some non-number values: "NA" and/or "Exempt".  I converted these to 0 and they are weighted in the average as such.  It would be easy enough to change this conversion or even remove those values from the average calclation completely
- I correctly weighted the `tract_minority_population_percent` column by only averaging the value once, per `census_tract` (tract id), per `derived_msa-md` (MSA ID).  EG: If an MSA has 1,000 loans but only 10 unique tracts, I calculate the average by adding up the 10 unique `tract_minority_population_percent` and dividing by 10, whereas the other aggregate/average columns use all the loans in the MSA

**Notes**:

- Tested and working on Windows (Node 12.x) and Mac (Node 15.x).  As this entire assignment is written in JavaScript/NodeJS, there is no reason to believe it wouldn't also work on Linux
- The final CSV output is stored in `outputCache/aggregateOutput.csv`
- Input data (fetched from Census and CFPB APIs) is cached/stored in the inputCache folder
- Output data (anything I did with the input data) is cached/stored in the outputCache folder
- If you delete any/all of the cache files/folders, you can kick-off the entire process again (`npm start`), which starting in `app.js` will:

1. Check for the cached MSA Census data in `./inputCache/msa.json`
1. If exists, load the file and call the `parseMSAData` function
1. If not exists, fetch the data from the Census API (note: the `DP03_0063E` key was used to fetch average household income), then call the `parseMSAData` function
1. The `parseMSAData` function will parse/filter the MSA data, retaining only MSA IDs and names where average household income is less than 50,000 in the `msaIdsUnder50k` array
1. The `downloadCfpbData` function is then called, which checks for the existence of `./inputCache/cfpbLoanData.csv` and loads data from the file, or else it downloads the data from CFPB API, passing in a list of MSA IDs
1. After the HMDA data is loaded, the `parseCfpbData` function is called, which will check for the existence of `./outputCache/usefulData.json` and load it
1. If `./outputCache/usefulData.json` doesn't exist, convert the CSV data from CFPB in to JSON using node-csv and then iterate through the data to retain only the needed data, and structure it for later use, then call the `crunchData` function
1. If `./outputCache/usefulData.json` exists, load the data and then call the `crunchData` function
1. `crunchData` will iterate through and reduce/aggregate the data in to its final values (loan counts, sums, averages, race columns, etc).  Aggregate data stored in the `aggregateData` global variable for use in the `generateCsv` function as well as the API
1. The `generateCsv` function is called next, which generates the final CSV output file as specified in the assignment and stores it in `outputCache/aggregateOutput.csv`
1. A web server is started which servers the static files in the `public` folder, as well as provides 2 APIs, `GET /aggregateData` which provides the aggregated data for the front-end visualization (bar chart) and `GET /aggregateCsvData` which provides the data to download the final CSV output file from the web page (`http://localhost:6789/`)

**Open-source libraries/frameworks/etc used:**

- [D3.js](https://github.com/d3/d3) for the visualization
- [NodeJS](https://github.com/nodejs) for the back-end and data engineering portion
- [Lodash](https://github.com/lodash/lodash) for some helper functions
- [node-express](https://github.com/expressjs/express) for the web server
- [node-csv](https://github.com/adaltas/node-csv) to convert CSV to JSON
- [gulp](https://github.com/gulpjs/gulp) task runner

**Screenshot of the web page showing the visualization:**

![Screenshot](/screenshot.png)