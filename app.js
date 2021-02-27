const express = require('express')
const app = express()
const fetch = require('node-fetch')
const fs = require('fs')
const csv = require('csv')
const _ = require('lodash')

// start the express server on this port
const listenPort = 6789

// set static content
app.use(express.static('public'))

// global vars
let msaJson, usefulJson, cfpbCsvText, aggregateData, msaIdsUnder50k = [], raceList = [], csvRaw = [], msaMap = {}

// check if MSA data is cached locally
try {
  if (fs.existsSync('./inputCache/msa.json')) {
    fs.readFile('./inputCache/msa.json', async (err, raw) => {
      if (err) {
        console.error(err)
        return
      }
      msaJson = JSON.parse(raw)
      parseMSAData()
    })
  } else {
    fetchMSAData()
  }
} catch(err) {
  console.error(err)
}

// fetch MSA data from Census API. `DP03_0063E` is the code/variable to get average household income
async function fetchMSAData () {
  try {
    fs.mkdir('./inputCache', { recursive: true }, (err) => {})
  } catch (e) {}

  let msaData = await fetch('https://api.census.gov/data/2019/acs/acs5/profile?get=NAME,DP03_0063E&for=metropolitan%20statistical%20area/micropolitan%20statistical%20area:*')
  msaJson = await msaData.json()
  // cache the data
  try {
    fs.writeFile('./inputCache/msa.json', JSON.stringify(msaJson), () => {})
    //file written successfully
  } catch (err) {
    console.error(err)
  }
  parseMSAData()
}

// parse MSA data
function parseMSAData () {
  msaJson.forEach(row => {
    // create list of MSAs with average household income under 50k, in the form of [MSA ID, MSA name]
    if (row[1] < 50000) {
      msaIdsUnder50k.push([row[2], row[0]])
      // add it to the MSA map to fetch MSA name by MSA ID later
      msaMap[row[2]] = row[0]
    }
  })

  try {
    fs.mkdir('./outputCache', { recursive: true }, (err) => {})
  } catch (e) {}

  downloadCfpbData()
}

// load HMDA data from cache, or fetch it from CFPB as needed
async function downloadCfpbData () {
  if (fs.existsSync('./inputCache/cfpbLoanData.csv')) {
    fs.readFile('./inputCache/cfpbLoanData.csv', async (err, raw) => {
      if (err) {
        console.error(err)
        return
      }
      cfpbCsvText = raw
      parseCfpbData()
    })
  } else {
    // pass in a comma-separated list of MSA IDs with under 50k avg household income
    let cfpbData = await fetch(`https://ffiec.cfpb.gov/v2/data-browser-api/view/csv?msamds=${msaIdsUnder50k.map(msa => msa[0]).join(',')}&years=2019`)
    cfpbCsvText = await cfpbData.text()
    // cache the results locally
    try {
      fs.writeFile('./inputCache/cfpbLoanData.csv', cfpbCsvText, () => parseCfpbData())
    } catch (err) {
      console.error(err)
    }
  }
}

// convert CSV to JSON and parse through the HMDA data
function parseCfpbData () {
  if (fs.existsSync('./outputCache/usefulData.json')) {
    fs.readFile('./outputCache/usefulData.json', async (err, raw) => {
      if (err) {
        console.error(err)
        return
      }
      usefulJson = JSON.parse(raw)
      crunchData()
    })
  } else {
    cfpbCsvText = fs.readFileSync('./inputCache/cfpbLoanData.csv', 'utf8')
    // convert to JSON
    csv.parse(cfpbCsvText, { columns: true }, (err, json) => {
      if (err) {
        console.error(err)
        return
      }
      _.forEach(json, (row, key) => {
        const columnsToKeep = [
          'census_tract',
          'derived_race',
          'loan_amount',
          'loan_to_value_ratio',
          'interest_rate',
          'total_loan_costs',
          'loan_term',
          'property_value',
          'income',
          'tract_minority_population_percent'
        ]
        json[key] = _.pick(row, columnsToKeep)
        json[key].msa_id = row['derived_msa-md'] // avoid using a property/key with a dash in it
      })
      usefulJson = json
      try {
        fs.writeFile('./outputCache/usefulData.json', JSON.stringify(json), () => {})
      } catch (err) {
        console.error(err)
      }
      crunchData()
    }
    )
  }
}

// perform all the necessary calcs to produce the desired output for the assignment
function crunchData () {
  // reducer to create/massage the data to the expected output
  aggregateData = usefulJson.reduce((ret, row) => {
    if (!ret[row.msa_id]) {
      ret[row.msa_id] = {
        tracts: {},
        raceCounts: {},
        avgLoanAmount: 0,
        avgLtvRatio: 0,
        avgInterestRate: 0,
        avgLoanCosts: 0,
        avgLoanTermMonths: 0,
        avgPropertyValue: 0,
        avgIncome: 0,
        loanCount: 0
      }
    }

    // keep track of the number of loans per MSA ID
    ret[row.msa_id].loanCount += 1

    // keep running count of loans per derived_race per MSA ID
    ret[row.msa_id].raceCounts[row.derived_race] = ret[row.msa_id].raceCounts[row.derived_race] ? ret[row.msa_id].raceCounts[row.derived_race] + 1 : 1

    // keep a running sum for each field, which we will use to calc the average later
    // convert any non-number to 0
    ret[row.msa_id].avgLoanAmount += parseFloat(row.loan_amount) || 0
    ret[row.msa_id].avgLtvRatio += parseFloat(row.loan_to_value_ratio) || 0
    ret[row.msa_id].avgInterestRate += parseFloat(row.interest_rate) || 0
    ret[row.msa_id].avgLoanCosts += parseFloat(row.total_loan_costs) || 0
    ret[row.msa_id].avgLoanTermMonths += parseFloat(row.loan_term) || 0
    ret[row.msa_id].avgPropertyValue += parseFloat(row.property_value) || 0
    ret[row.msa_id].avgIncome += parseFloat(row.income) || 0

    // only need to take the average of a single tract_minority_population_percent per census_tract per MSA ID so it is weighted evenly
    // this will just keep over-writing the census_tract property, so when we calculate the average there is 1 value per censust tract
    ret[row.msa_id].tracts[row.census_tract] = parseFloat(row.tract_minority_population_percent) || 0

    return ret
  }, {})

  // map i use so i can build a complete/unique list of all derived_races
  raceMap = {}

  // calculate the averages
  for (let key in aggregateData) {
    aggregateData[key].avgLoanAmount = _.round(aggregateData[key].avgLoanAmount / aggregateData[key].loanCount, 2)
    aggregateData[key].avgLtvRatio = _.round(aggregateData[key].avgLtvRatio / aggregateData[key].loanCount, 2)
    aggregateData[key].avgInterestRate = _.round(aggregateData[key].avgInterestRate / aggregateData[key].loanCount, 2)
    aggregateData[key].avgLoanCosts = _.round(aggregateData[key].avgLoanCosts / aggregateData[key].loanCount, 2)
    aggregateData[key].avgLoanTermMonths = _.round(aggregateData[key].avgLoanTermMonths / aggregateData[key].loanCount, 2)
    aggregateData[key].avgPropertyValue = _.round(aggregateData[key].avgPropertyValue / aggregateData[key].loanCount, 2)
    // convert to actual income (EG 32 actually represents 32,000, so * 1000)
    aggregateData[key].avgIncome = _.round(aggregateData[key].avgIncome * 1000 / aggregateData[key].loanCount, 2)
    
    // store the sum of minority population values to average out
    let minorityPopulationSum = 0
    for (let tractKey in aggregateData[key].tracts) {
      minorityPopulationSum += aggregateData[key].tracts[tractKey]
    }
    // calculate the average minority population for each MSA id    
    aggregateData[key].avgMinorityPopulation = _.round(minorityPopulationSum / Object.keys(aggregateData[key].tracts).length, 2)

    // build list of race categories for aggregate CSV deliverable
    for (let race in aggregateData[key].raceCounts) {
      if (!raceMap[race] === true) raceList.push(race)
      raceMap[race] = true
    }
  }

  generateCsv()
}

// func to generate the final CSV output of the assignment
function generateCsv () {
  // init var to hold CSV data, begin header row
  const csvData = [['MSA Name', 'MSA ID','Number of Loans', 'Avg Loan Amount', 'Avg LTV Ratio', 'Avg Interest Rate', 'Avg Loan Cost', 'Avg Loan Terms (months)', 'Avg Property Value', 'Avg Income', 'Avg Minority Population (pecent)']]
  // append each "derived_race" as a header column
  csvData[0].push(...raceList)
  
  // populate the CSV output with aggregate data
  for (let msa of msaIdsUnder50k) {
    // only proceed if CFPB returned HMDA loan data for the iterated MSA IDs
    if (aggregateData[msa[0]]) {
      let csvRow = [`"${msa[1]}"`, msa[0]]
      csvRow.push(aggregateData[msa[0]].loanCount)
      csvRow.push(aggregateData[msa[0]].avgLoanAmount)
      csvRow.push(aggregateData[msa[0]].avgLtvRatio)
      csvRow.push(aggregateData[msa[0]].avgInterestRate)
      csvRow.push(aggregateData[msa[0]].avgLoanCosts)
      csvRow.push(aggregateData[msa[0]].avgLoanTermMonths)
      csvRow.push(aggregateData[msa[0]].avgPropertyValue)
      csvRow.push(aggregateData[msa[0]].avgIncome)
      csvRow.push(aggregateData[msa[0]].avgMinorityPopulation)
      for (let race of raceList) {
        csvRow.push(aggregateData[msa[0]].raceCounts[race] || 0)
      }
      csvData.push(csvRow)
    }
  }

  // convert to csv
  csvData.forEach(row => csvRaw.push(row.join(',')))

  // save to file
  try {
    fs.writeFile('./outputCache/aggregateOutput.csv', csvRaw.join("\n"), () => {})
  } catch (err) {
    console.error(err)
  }
}


/**
 * "aggregateData" API: fetch the aggregated data
 */
app.get('/aggregateData', (request, response) => {
  // wrap the func in a try/catch block for graceful error handling
  try {
    const results = []
    for (let key in aggregateData) {
      aggregateData[key].group = key
      aggregateData[key].msaName = msaMap[key]
      results.push(aggregateData[key])
    }
    response.send(results)
  } catch (err) {
    // for now just return an empty array on error
    response.send([])
  }
})

/**
 * "aggregateCsvData" API: fetch the aggregate data in csv format
 */
app.get('/aggregateCsvData', (request, response) => {
 response.send(csvRaw)
})


console.log('Server starting @ http://localhost:' + listenPort)

module.exports = app.listen(listenPort)
