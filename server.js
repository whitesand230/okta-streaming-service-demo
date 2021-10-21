var express = require('express');
var app = express();
var cookieParser = require('cookie-parser');
const axios = require('axios');
var qs = require('qs');
var QRCode = require('qrcode');
require('dotenv').config();
const store = require("store2");

//HEADERS USED FOR ALL REQUEST
const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
}

const AUTHZID = process.env.AUTHZ_ID || 'default';
const SCOPE = process.env.SCOPES || 'openid profile offline_access';

const AUTHZ_ENDPOINT = 'https://' + process.env.OKTA_HOST + '/oauth2/' + AUTHZID + '/v1/device/authorize';
const TOKEN_ENDPOINT = 'https://' + process.env.OKTA_HOST + '/oauth2/' + AUTHZID + '/v1/token'

//set the view engine to ejs
app.set('view engine', 'ejs');
app.use(cookieParser());
app.use(express.static(__dirname + '/public'));

app.get('/', (req, res) => {

    if (store('accessToken')) {
        res.status(301).redirect('/session');
    }

    if (req.cookies.resdata != null || req.cookies.resdata == '') {
        if(process.env.DEBUG === 'true'){
            console.log("Calling Token EndPoint");
        }

        //CREATE PAYLOAD FOR TOKEN ENDPOINT
        payload = {
            'client_id': process.env.CLIENT_ID,
            'grant_type': 'urn:ietf:params:oauth:grant-type:device_code',
            'device_code': req.cookies.resdata.device_code
        };

        if(store('accessToken')){
            return res.end();
        }

        //call Okta token endpoint.
        axios.post(TOKEN_ENDPOINT, qs.stringify(payload), { headers })
        .then(response => {
            //We got the access and id tokens
            store('accessToken', response.data.access_token);
            store('idToken', response.data.id_token);
            if(response.data.refresh_token){
                //console.log(response.data.refresh_token);
                store('refreshToken', response.data.refresh_token)
            }
            //Display Response if DEBUG
            if(process.env.DEBUG === 'true'){
                console.log("Response from Token Endpoint: ")
                console.log(response.data);
            }
        })
        .catch(error => {
            if(process.env.DEBUG === 'true'){
                console.log(error);
            }
        })

        displayPage(req.cookies.resdata, res, false);
    }
    else {
        if(process.env.DEBUG === 'true'){
            console.log("Calling Authorize EndPoint");
        }

        //CREATE PAYLOAD FOR AUTHZ ENDPOINT
        payload = {
            'client_id': process.env.CLIENT_ID,
            'scope': SCOPE  //will use default OIDC scopes if none are provided.
        }

        //CALLING AUTHZ ENDPOINT
        axios.post(AUTHZ_ENDPOINT, qs.stringify(payload), { headers })
            .then(response => {
                displayPage(response.data, res, true);
            })
            .catch(error => {
                console.log(error, error.response && error.response.data);
                if (error) {
                    res.send(error.response.data);
                }
            })
    }

})

//REFRESH DEVICE CODE AND USER CODE
app.post('/', (req, res) =>{
    //check for resData
    if(req.cookies.resdata){
        //TODO
        if(process.env.DEBUG === 'true'){
            console.log("Refreshing Device Code");
        }

        //CREATE PAYLOAD FOR AUTHZ ENDPOINT
        payload = {
            'client_id': process.env.CLIENT_ID,
            'scope': SCOPE  //will use default OIDC scopes if none are provided.
        }

        //CALLING AUTHZ ENDPOINT
        axios.post(AUTHZ_ENDPOINT, qs.stringify(payload), { headers })
            .then(response => {
                displayPage(response.data, res, true);
            })
            .catch(error => {
                if(process.env.DEBUG === 'true'){
                    console.log("Error when calling Token Endpoint.");
                    console.log(error);
                }
                res.send(error.response.data);
            })
    }
    else{
        //TODO
        displayPage(req.cookies.resdata, res, false);
    }
})

app.get('/session', (req, res) => {

    if (store('accessToken')) {

        res.clearCookie('resdata');
        res.cookie('accessToken', store('accessToken'), {'sameSite': 'strict'});
        res.cookie('idToken', store('idToken'), {'sameSite': 'strict'})
        res.cookie('refreshToken', store('refreshToken'), {'sameSite': 'strict'});
        res.render('pages/access', {
            accessToken: store('accessToken'),
            idToken: store('idToken')
        });
    }

    else {
        if(process.env.DEBUG === 'true'){
            console.log('Missing access tokens. Redirecting to login page.');
        }

        res.status(302).redirect('/');
    }

})

//REFRESH ACCESS TOKEN
app.post('/session', (req,res) =>{
    if(req.cookies.refreshToken){
        payload = {
            'client_id': process.env.CLIENT_ID,
            'grant_type':'refresh_token',
            'redirect_uri':'http://localhost:8080',
            'scope': SCOPE,
            'refresh_token': req.cookies.refreshToken
        };

        if(process.env.DEBUG === 'true'){
            console.log("Getting Refreshing Token");
        }

        //CALLING TOKEN ENDPOINT
        axios.post(TOKEN_ENDPOINT,qs.stringify(payload), {headers})
        .then(response => {
            if(process.env.DEBUG === 'true'){
                console.log("Getting Refreshing Token");
                console.log("Response from Token Endpoint:");
                console.log(response.data);
            }
            store('accessToken', response.data.access_token);
            store('idToken', response.data.id_token);
            if(response.data.refresh_token){
                store('refreshToken', response.data.refresh_token);
                res.cookie('refreshToken', store('refreshToken'), {'sameSite': 'strict'});
            }
            res.cookie('accessToken', store('accessToken'), {'sameSite': 'strict'});
            res.cookie('idToken', store('idToken'), {'sameSite': 'strict'});


            res.render('pages/access', {
                accessToken: store('accessToken'),
                idToken: store('idToken')
            });

        })
        .catch(error => {
            if(process.env.DEBUG === 'true'){
                console.log("Error when calling Token Endpoint.");
                console.log(error);
            }

        })
    }
    else{
        //No token just refresh the page.
        res.render('pages/access', {
            accessToken: store('accessToken'),
            idToken: store('idToken')
        });
    }

})

app.get('/logout', (req, res) => {
    store.clearAll();
    res.clearCookie('accessToken');
    res.clearCookie('idToken');
    res.clearCookie('refreshToken');
    res.render('pages/logout');
})

app.listen(8080);
console.log('Server is listening on port 8080');

function displayPage(oktaResponseData, res, addCookie){
    QRCode.toDataURL(oktaResponseData.verification_uri_complete, function (err, url) {
        if (err) return console.log("error occurred")
        if(process.env.DEBUG === 'true'){
            console.log("***Okta Authorization Endpoint response***");
            console.log("Response from Authorization Endpoint: ")
            console.log(oktaResponseData);
        }
        if(addCookie) {
            res.cookie("resdata", oktaResponseData, {'sameSite': 'strict'});
        }
        var modifyString = oktaResponseData.user_code.substring(0, 4) + "-" + oktaResponseData.user_code.substring(4, oktaResponseData.user_code.length);
        res.render('pages/index', {
            jsonResData: JSON.stringify(oktaResponseData),
            welcomeLine: 'Please visit <a href="' + oktaResponseData.verification_uri + '" target="_blank">' + oktaResponseData.verification_uri + '</a> and enter code: <br/> <b>' + modifyString + '</b> to activate your device.',
            qrCode: url,
            Code: oktaResponseData.device_code
        });
        res.end();
    })
}