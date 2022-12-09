const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const helmet = require('helmet')
const axios = require('axios')

const PORT = process.env.PORT || 5000
const isProduction = process.env.NODE_ENV === 'production'

//notes: requires setting up proxy service or implementing oauth on OCM request
const ocm = {
  'hostname': 'https://demodev-oce0001.cec.ocp.oraclecloud.com',
  'path': '/pxysvc/proxy/oce-apps/items',
  'headers': { 
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest'
  },
  'repositoryId': '6EF7F6A4A8FE4473805DE9829C14CAF7',
  'language': 'en'
};

//notes: bearer token valid for 60 minutes
//docs: https://developer.loopio.com/docs/loopio-api/55ef47e33f5eb-list-library-entries-you-can-interact-with
const loopio = {
  'hostname': 'https://api.int01.loopio.com',
  'oauth': '/oauth2/access_token',
  'path': '/data/v2/libraryEntries',
  'client': 'bGrPhCPgNxhyJ5HavVZWa/Qjxyfaw8bKjHREwNSQKzg=',
  'secret': '54xJVsibYWRUkLR7o/4m5DQJWDXrco529bgwAO9hQQg=',
  'filter': [
    {
      'key': 'lastUpdatedDate',
      'value': '{"gte":"2022-01-01T00:00:00Z"},'
    },
    {
      'key': 'language',
      'value': 'en'
    },
    {
      'key': 'tags',
      'value': ["PullYes"]
    }
  ],
  'pageSize': 100,
}

const dataMap = {
  'assetType': 'LoopioItem',
  'name': 'id',
  'fields': [
    {
      'id': 'loopioId',
      'type': 'text',
      'source': 'id'
    },
    {
      'id': 'loopioData',
      'type': 'json',
    }
  ],
  'tags': 'tags'
};

const app = express()

let bearerToken = '';
let bearerTokenIssued = 0;

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())
app.use(helmet())

// Poll loopio API and sync to OCM API 
const cron = async (req, res) => {
  try {
    //build loopio filter
    let filter = [];
    loopio.filter.forEach(item => {
      filter.push(item.key + "=" + item.value);
    });
    let resource = `${loopio.hostname}${loopio.path}?filter=${filter.join(';')}&pageSize=${loopio.pageSize}`;

    //get loopio data
    axios({
      method: 'get',
      url: resource,
      headers: {
        Authorization: "Bearer " + loopio.bearerToken
      }
    })
    .then(response => {
      let promises = [];

      response.data.items.forEach(item => {
        //check if content already exists
  
        //build tags
        let tags = [];
        item[dataMap.tags].forEach(tag => {
          tags.push({"name": tag});
        });

        //Rest API for Content Management
        //https://docs.oracle.com/en/cloud/paas/content-cloud/rest-api-manage-content/op-management-api-v1.1-items-post.html
        let asset = {
          "repositoryId": ocm.repositoryId,
          "type": dataMap.assetType,
          "name": item[dataMap.name],
          "language": ocm.language,
          "translatable": true,
          "fields": {},
          "tags": {
            "data": tags
          }
        };
        dataMap.fields.forEach(field => {
          if (field.type == 'text')
          {
            asset.fields[field.id] = item[field.source];
          }
          if (field.type == 'json')
          {
            let json = {};
            loopio.fields.forEach(jsonField => {
              json[jsonField] = item[jsonField];
            });
            asset.fields[field.id] = json;
          }
        });
        promises.push(axios({
          method: 'post',
          url: ocm.hostname + ocm.path,
          data: asset,
          headers: ocm.headers 
        }));
      }); //end foreach loopioData
  
      Promise.all(promises).then(function(results) {
        res.status(201).send("Created");
      });

    })
    .catch(error => {
      res.status(400).send({ status: error.status, message: error.message })
    });
  } catch (err) {
    console.error('* test error:\n' + err);
    res.status(500).send({ status: 500, error: 'Existential server error' })
  }
}

app
  .get('/cron', cron)
  .get('*', function(req, res) {
    res.status(404).send('Resource not found');
  })
  .listen(PORT, () => console.log(`OCM Loopio Node.js listening on ${ PORT }`))