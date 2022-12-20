const express = require('express')
const bodyParser = require('body-parser')
const cors = require('cors')
const helmet = require('helmet')
const axios = require('axios')
const querystring = require('querystring')

const PORT = process.env.PORT || 5000
const isProduction = process.env.NODE_ENV === 'production'

//notes: requires setting up proxy service or implementing oauth on OCM request
const ocm = {
  'hostname': 'https://demodev-oce0001.cec.ocp.oraclecloud.com',
  'path': '/pxysvc/proxy/loopio/items',
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
  'oauthPath': '/oauth2/access_token',
  'path': '/data/v2/libraryEntries',
  'client': '',
  'secret': '',
  'filter': [
    {
      'key': '"language"',
      'value': '"en"'
    },
    {
      'key': '"tags"',
      'value': '["PullYes"]'
    }
  ],
  'pageSize': 100,
}

let loopioToken = {
  'lifeTime': '3600',
  'value': '',
  'issued': 0
};

const dataMap = {
  'assetType': 'LibraryEntry',
  'name': 'item.questions[0].text',
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

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
app.use(cors())
app.use(helmet())

// Poll loopio API and sync to OCM API 
const test = async (req, res) => {
  try {
    let token = await getLoopioToken();
    if (token != null)
    {
      //build loopio filter
      let filter = [];
      loopio.filter.forEach(item => {
        filter.push(item.key + ':' + item.value);
      });

      //get loopio data
      axios({
        method: 'get',
        url: loopio.hostname + loopio.path + "?pageSize=" + loopio.pageSize + "&filter={" + filter.join(',') + "}",
        headers: {
          Authorization: "Bearer " + token
        }
      })
      .then(response => {
        if (response.status == 200)
        {
          //console.log(response.data.items);
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
              "name": eval(dataMap.name),
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
                asset.fields[field.id] = item;
              }

            });
            //console.log(asset);

            promises.push(axios({
              method: 'post',
              url: ocm.hostname + ocm.path,
              data: asset,
              headers: ocm.headers 
            }));

          }); //end foreach loopio data
          Promise.all(promises).then(function(results) {
            res.status(201).send("Created");
          });
        }
        else
        {
          console.error('* Api error:\n' + response.status);
          res.status(response.status).send({ status: response.status, error: response.error })
        }
      });
    }
    else
      res.status(500).send({ status: 500, error: 'Token not available' })
  } catch (err) {
    console.error('* Api error:\n' + err);
    res.status(500).send({ status: 500, error: 'Existential server error' })
  }
}

app
  .get('/test', test)
  .get('*', function(req, res) {
    res.status(404).send({status: 404, error: 'Resource not found'});
  })
  .listen(PORT, () => console.log(`(⌐■_■) OCM Loopio Node.js [v0.06] listening on ${ PORT }`))

//returns loopio access_token
async function getLoopioToken()
{
  //check token cache
  let now = Math.floor(Date.now() / 1000);
  if (loopioToken.issued + loopioToken.lifeTime > now)
    return loopioToken.value;

  //get token and set cache
  axios({
    method: 'post',
    url: loopio.hostname + loopio.oauthPath,
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    data: querystring.stringify({
      "grant_type": "client_credentials",
      "scope": "library:read",
      "client_id": loopio.client,
      "client_secret": loopio.secret
    })
  })
  .then(response => {
    if (response.status == 200)
    {
      loopioToken.value = response.data.access_token;
      loopioToken.issued = now;    
      console.log(`* retrieved bearer token: ${loopioToken.value}`);
      return loopioToken.value;
    }

    return null;
  })
  .catch(error => {
    console.log(error.response);
    return null;
  });
}
