#! /usr/bin/env node
import { setIntervalAsync, 
	clearIntervalAsync } from 'set-interval-async';
import Datastore from "nedb";
import 'dotenv/config'; //syntax according to dotenv doc
import 'dotenv-expand/config';
import { MyAPI, handleApiResource } from "../web-utils/src/http-utils/MyApiAxiosWrapper.mjs"
import { enterCredentialsOrTimeoutAfter } from "./credUtil.mjs"

//dotenv.config();

// Setting up the nedb database
const database = new Datastore('someDB.db'); //rename for your own use case
database.loadDatabase();

// wrapping setTimeout in a promise to generate time gaps in the monitor sequence
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// debug const
const DEBUG_DB = false; // for database-related debug
const DEBUG_RESOURCE = false; // for API resource-related debug
const DEBUG_TIMING = false; //for timing-related debug
//console.log(process.env); // to double-check env variables

// ------------------------- MONITOR SETTINGS ------------------------------------
// API general settings
const API_URL = process.env.API_URL;
//const API_ENV = process.env.API_ENV;
const RESOURCE_KEY = process.env.RESOURCE_KEY;
const MIN_RESOURCE_THRESH = parseInt(process.env.MIN_RESOURCE_THRESH);
let API_RESOURCE = parseInt(process.env.API_RESOURCE);
// Request settings
const LOGIN_ENDPOINT = process.env.LOGIN_ENDPOINT;
//const EXTRA_LOGIN_FIELDS = JSON.parse(process.env.EXTRA_LOGIN_FIELDS);
const PATH_TO_TOKEN = process.env.PATH_TO_TOKEN;
const TOKEN_FIELD = process.env.TOKEN_FIELD;
const TOKEN_FIELD_ALT = process.env.TOKEN_FIELD_ALT;
const HTTP_METHOD = process.env.HTTP_METHOD;
const RESOURCE_TO_FETCH = process.env.RESOURCE_TO_FETCH;
const DEFAULT_HEADERS = JSON.parse(process.env.DEFAULT_HEADERS);
const LOGIN_REQUEST_TIMEOUT = process.env.LOGIN_REQUEST_TIMEOUT;
const DUMMY_REQUEST_TIMEOUT = process.env.DUMMY_REQUEST_TIMEOUT;
// Response settings - which fields are we interested in monitoring?
const FIELD1_TO_MONITOR_AT_LOGIN = process.env.FIELD1_TO_MONITOR_AT_LOGIN;
const FIELD2_TO_MONITOR_AT_LOGIN = process.env.FIELD2_TO_MONITOR_AT_LOGIN;
const FIELD1_TO_MONITOR = process.env.FIELD1_TO_MONITOR;
const FIELD2_TO_MONITOR = process.env.FIELD2_TO_MONITOR;
// Timing settings
const USER_CRED_TIMEOUT = parseInt(process.env.USER_CRED_TIMEOUT);
const DT_FIRST_REQ = parseInt(process.env.DT_FIRST_REQ);
const DT_DUMMY_REQ = parseInt(process.env.DT_DUMMY_REQ);
const DT_AUTH_CYCLE = parseInt(process.env.DT_AUTH_CYCLE); 
const DT_SESS_AFT_FIRST_RUN = parseInt(process.env.DT_MONITOR_SESS_AFT_FIRST_RUN);
// ----------------------END OF MONITOR SETTINGS ---------------------------------

// init un / pw globally (TODO other pattern)
let GLOBAL_UN = '';
let GLOBAL_PW = '';

// ------------------------------------ MAIN SEQUENCE DEF ----------------------------------------
async function mainSequence() {
	// if enterCredentials never called, use the data returned from prompt
	// else, keep using global stored un/pw - to remove if API needs no auth
	const cred = await enterCredentialsOrTimeoutAfter(USER_CRED_TIMEOUT);
	if (cred!=="credentials already set") {
		GLOBAL_UN = cred.username,
		GLOBAL_PW = cred.password
	}
	
	try {
		// -------------------------------- 1) LOGIN --------------------------------------
		// Drop the 1) + 2) sections if sending requests to your API does not require auth
		// or adjust 1) section to fit how auth works with your API
		console.log("Generating new token...");
	
		const api = new MyAPI();
		api.URL = API_URL

		// staged prep login req body in an object, then merge with EXTRA_LOGIN_FIELDS
		const loginCred = {
			username: GLOBAL_UN,
			password: GLOBAL_PW,
		};
		//const loginBody = Object.assign(loginCred, EXTRA_LOGIN_FIELDS);
		//console.log("loginBody merged: ", loginBody);

		const loginResponse = await api.performRequest(
			'post', 
			LOGIN_ENDPOINT, 
			DEFAULT_HEADERS,
			LOGIN_REQUEST_TIMEOUT,
			loginCred); //loginBody
		
		if (loginResponse.status != 200) {
			throw new Error("invalid credentials - try again");
		}
		const loginResponseD = loginResponse.data;
		const loginResponseH = loginResponse.headers;
		api.token = loginResponseD[TOKEN_FIELD];

		// ------------------- 2) LOGIN SUCCESSFUL => TOP ------------------------------
		const dtToken = Date.now();  // instant the token becomes available
		const dtTokenReadable = new Date(dtToken);
		
		const nextExpiration = dtToken + DT_AUTH_CYCLE; // instant the token will expire
		const nextExpirationReadable = new Date(nextExpiration);

		console.log(`Key from login: ${api.token} will be available ` 
		+ `from ${dtTokenReadable} to ${nextExpirationReadable},` +
		` for the next ${DT_AUTH_CYCLE/(1000*60)} min.`);
		
		// For example: monitoring content in login headers (if any)
		//const loginResponseH = loginResponse.headers;
		console.log(`xxxxx mock login headers: ${loginResponseH}`);
		//TODO fix console.log [object Object]
		//console.log(`xxxxx mock login data: ${loginResponseD}`);

		// DATA --> DATASTORE - random example of user data to record - replace with your own
		const monitoredLoginData = {
			'request_type' : 'AUTH',
			'response_date' : loginResponseH.date,
			'userFirstName' : loginResponseD[FIELD1_TO_MONITOR_AT_LOGIN],
			'userLastName' : loginResponseD[FIELD2_TO_MONITOR_AT_LOGIN]
		};
		database.insert(monitoredLoginData);
		
		// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// If not enough resources, return to avoid 429 too many requests
		// dummyJSON API starts at a limit of 120 calls,
		// so e.g. MIN-RESOURCE_THRESH set at 5 calls
		API_RESOURCE = loginResponseH[RESOURCE_KEY];
		let resourceHandled = handleApiResource(API_RESOURCE, 
			MIN_RESOURCE_THRESH, 
			monitoredLoginData['request_type']);
		if (resourceHandled === 'resource_nok') return resourceHandled;

		// ------------------------- 3) NON-LOGIN REQUEST (E.G: GET) --------------------------------
		console.log(`Post authentication, waiting ${DT_FIRST_REQ/(1000*60)}` +
		` min initially before triggering 1st dummy request...`); 
		await sleep(DT_FIRST_REQ); // 1. wait dtFirstReq ms
		
		// timestamping instant when the While loop is about to be executed
		let tsWhile = Date.now();

		// 2. perform the request as long as token is valid
		while (tsWhile <= nextExpiration) {
			//staged prep dummy req headers in an object
			let dummyReqHeaders = { headers: DEFAULT_HEADERS };
			dummyReqHeaders[TOKEN_FIELD] = api.token;

			const dummyResponse = await api.performRequest(
				HTTP_METHOD,
				RESOURCE_TO_FETCH,
				dummyReqHeaders,
				DUMMY_REQUEST_TIMEOUT);
			const dummyResponseD = dummyResponse.data;
			const dummyResponseH = dummyResponse.headers;

			// if performRequest did not resolve, .headers will break, hence the if
			if (dummyResponse) {
				console.log(`xxxxx mock dummy request headers: ${dummyResponseH}`);
				//TODO fix console.log [object Object]
				//console.log(`xxxxx mock dummy request data: ${dummyResponseD}`);
				
				// DATA --> DATASTORE - random example of data to record - replace with your own
				const monitoredDummyData = {
					'request_type' : 'GET/Dummy',
					'response_date': dummyResponseH.data,
					'quote_id' : dummyResponseD[FIELD1_TO_MONITOR],
					'quote' : dummyResponseD[FIELD2_TO_MONITOR]
				};
				database.insert(monitoredDummyData);
				

				// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
				// If not enough resources, break to avoid 429 too many requests
				API_RESOURCE = dummyResponseH[RESOURCE_KEY];
				let resourceHandled = handleApiResource(API_RESOURCE, 
					MIN_RESOURCE_THRESH, 
					monitoredDummyData['request_type']);
				if (resourceHandled === 'resource_nok') return resourceHandled;
			}
			// Wait *DT_DUMMY_REQ* ms before next Non-Login Request
			await sleep(DT_DUMMY_REQ);
			
			tsWhile = Date.now(); // reassess `tsWhile` to keep running / stop
			if (DEBUG_TIMING) console.log(`tsWhile value end of loop: ${tsWhile}`);

		}

		// when a cycle: (auth + [req,...,req]) has completed, msg gets returned
		// msg is awaited at 1st mainSequence iteration
		// its reception conditions 2nd mainSequence execution
		const msg = 'completed_mainSeq_report';
		
		return msg;

	} catch (err) {
		console.error(err);
	}
};
// --------------------------------------- END OF MAIN SEQUENCE DEF --------------------------------------




// ----------------------------------------- MONITOR EXECUTION -------------------------------------------
// If better design patterns/practices to perform the below, contributing is welcome!

async function callOrStopMainSequence() {
	if (parseInt(API_RESOURCE) < MIN_RESOURCE_THRESH) {
		throw new Error(`[MAIN SEQ GO/NO GO MSG] !!!! `
		`Can't run mainSequence anymore due to `+
		`not enough API resources available `+`
		- please check your REST API capability and retry later.`);
	} else {
		console.log(`[MAIN SEQ GO/NO GO MSG]\n
		-------------------------- STARTING A MAIN SEQUENCE RUN `+
		`------------------------------------`);
		
		return await mainSequence();
	}
};

// main immediately invoked
(async function main() {
	
	// 1st call of mainSequence to await for user manual input
	const firstExecResult = await callOrStopMainSequence(); 
	
	// if we triggered setIntervalAsync at that stage,
	// then the 1st monitoring cycle would be a little shorter,
	// due to using up some of the cycle time for user manual input
	// so we don't, and do it at 2nd run instead.

	// CASE A: returned from 1st call with success msg
	// => OK to proceed to running the monitoring sequence in loop
	if (firstExecResult === 'completed_mainSeq_report') {
		console.log(`
		[MAIN EXEC MSG] Successfully returned from very 1st mainSequence call: ` + `
		(msg received: ${firstExecResult}) running 2nd mainSequence now...`);
		
		let myIntervalAsync = setIntervalAsync(callOrStopMainSequence, DT_AUTH_CYCLE);
		callOrStopMainSequence(); //called in sync with myIntervalAsync
		
		// Timeout past *DT_MONITOR_SESS_AFT_FIRST_RUN*
		// `clearIntervalAsync` terminates the process (clean!)
		setTimeout ( _ => {
			console.log(`[MAIN EXEC MSG] `+ 
			`Monitor session timing out now\n` +
			`- clearing myIntervalAsync after last execution cycle` + 
			`is complete.`);
			clearIntervalAsync(myIntervalAsync);
		}, DT_SESS_AFT_FIRST_RUN);
	

	// CASE B: returned from 1st call without success or known error cause
	// => the error is not related to a lack of API resource.
	} else if (firstExecResult !== 'resource_nok' 
	&& firstExecResult !== 'completed_mainSeq_report') {
		throw new Error(`[MAIN EXEC MSG] !!!! ` + 
		`Couldn't received completion message ` + 
		`from mainSequence - not due to lack of API resource. ` + 
		`Maybe check for syntax / main execution logics error?`);
	
	// CASE C: error due to lack of API resource
	} else {
		throw new Error(`[MAIN EXEC MSG] !!!! ` + 
		`Couldn't loop callOrStopMainSequence\n`+
		`- not enough API resources available\n` +
		`- please check your REST API capability and retry later.`);
	}
})();
// --------------------------------- END OF MONITOR EXECUTION CODE --------------------------------------