#! /usr/bin/env node
import { setIntervalAsync, 
	clearIntervalAsync } from 'set-interval-async';
import Datastore from "nedb";

import { MyAPI, 
	enterCredentialsOrTimeoutAfter } from "./apiUtils.mjs";
	
// Setting up the nedb database
const database = new Datastore('ArenaRemainingCallsMay23.db'); //replace with whatever name.db
database.loadDatabase();

// wrapping setTimeout in a promise 
// to use for time gaps in the monitor sequence
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// debug const
const DEBUG_DB = false; // for database-related debug
const DEBUG_RESOURCE = false; // for API resource-related debug
const DEBUG_TIMING = false; //for timing-related debug

// ------------------------- MONITOR SETTINGS ------------------------------------
// API properties // e.g. --------------------------------------------------------

// API general access
const API_URL = "https://api.arenasolutions.com/v1";
const API_ENV = "897380659"; // FAEL's Arena prod environment workspace ID

// API resource handling
let API_CURRENT_RESOURCE = 10000000; // init with arbitrary number >= max resource
const MIN_RESOURCE_THRESH = 0; // reaching e.g. 1000 calls left, stop monitor

// Request settings > which request are we sending? // GET/someDummyResource
const HTTP_METHOD = 'get';
const RESOURCE_TO_FETCH = '/items?number=FFFA001354'; //dummy resource (unreleased A/W)
const DEFAULT_HEADERS = {'Content-Type': "application/json"};
// Request settings > timeouts (ms)
const LOGIN_REQUEST_TIMEOUT = 20*1000;
const DUMMY_REQUEST_TIMEOUT = 10*1000;

// Response settings: which fields are we interested in?
const FIELD1_TO_MONITOR = 'date'; //e.g. date
const FIELD2_TO_MONITOR = 'x-arena-requests-remaining'; //header of interest for calls
const RESOURCE_KEY = 'remaining_calls'

// Monitor time settings (ms) = arbitary values ----------------------------------

// timeout if user remains inactive at prompt
const USER_CREDENTIALS_TIMEOUT = 30*1000; 

// Monitor cycling
const DT_FIRST_REQ = 10*60*1000; // dt (auth resp --> 1st non-login req) 
const DT_DUMMY_REQ = 10*60*1000; // dt (nth non-login resp --> (n+1)th non-login req)
// dt(nth cycle: (auth + [req,...,req]) --> (n+1)th cycle: (auth + [req,...,req]))
// /!\ Recommendation before setting dtAuthCycle /!\
// /!\ read "Monitor cycling" section of the READme /!\
const DT_AUTH_CYCLE = 85*60*1000; 
// will clear setIntervalAsync after this monitoring session duration
const DT_MONITOR_SESS_AFT_FIRST_RUN = 16*60*60*1000; //e.g. 8am-11pm: 15*60*60*1000
// ----------------------END OF MONITOR SETTINGS ---------------------------------




// init un / pw globally - TODO: Try the module pattern from MDN doc on IIFE
let GLOBAL_UN = '';
let GLOBAL_PW = '';
// ------------------------------------ MAIN SEQUENCE DEF ----------------------------------------
async function mainSequence() {
	// if enterCredentials never called, use the data returned from prompt
	// else, keep using global stored un/pw - to remove if API needs no auth
	const cred = await enterCredentialsOrTimeoutAfter(USER_CREDENTIALS_TIMEOUT);
	if (cred!=="credentials already set") {
		GLOBAL_UN = cred.username,
		GLOBAL_PW = cred.password
	}
	
	outerloop: try {
		// -------------------------------- 1) LOGIN --------------------------------------
		// Drop the 1) + 2) sections if sending requests to your API does not require auth
		// or adjust 1) section to fit how auth works with your API
		console.log("Generating new token...");
	
		const api = new MyAPI();
		api.URL = API_URL

		const loginResponse = await api.performRequest(
			'post', 
			'/login', 
			DEFAULT_HEADERS,
			LOGIN_REQUEST_TIMEOUT,
			{ 
				email: GLOBAL_UN,
				password: GLOBAL_PW,
				workspaceId: API_ENV,
			});
		
		//TODO: testing credentials invalidation at that stage
		if (loginResponse.status != 200) {
			throw new Error("invalid credentials - try again");
		}	
		api.token = loginResponse.data.arenaSessionId;

		// ------------------- 2) LOGIN SUCCESSFUL => TOP ------------------------------
		
		const dtToken = Date.now();  // instant the token becomes available
		const dtTokenReadable = new Date(dtToken);
		
		const nextExpiration = dtToken + DT_AUTH_CYCLE; // instant the token will expire
		const nextExpirationReadable = new Date(nextExpiration);

		console.log(`
		Key from login: ${api.token} will be available ` 
		+ `from ${dtTokenReadable} to ${nextExpirationReadable},` +
		` for the next ${DT_AUTH_CYCLE/(1000*60)} min.`);
		
		// For example: monitoring headers at login
		const loginResponseH = loginResponse.headers;
		console.log(loginResponseH);

		// DATA --> DATASTORE
		// data to monitor at login, from the headers
		const monitoredLoginData = {
			'request_type' : 'POST/Login',
			'response_date' : loginResponseH[FIELD1_TO_MONITOR],
			'remaining_calls' : loginResponseH[FIELD2_TO_MONITOR]
		};
		database.insert(monitoredLoginData);
		if (DEBUG_DB) {
			console.log(`DB AT LOGIN DATA LOGGING: ${database}`);
		}
		
		// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		// If not enough resources, return to avoid 429 too many requests
		API_CURRENT_RESOURCE = monitoredLoginData['remaining_calls'];
		if (DEBUG_RESOURCE) {
			console.log(`LATEST RESOURCE - LOG AT LOGIN REQ: ${API_CURRENT_RESOURCE}`);
		}
		if (parseInt(API_CURRENT_RESOURCE) < MIN_RESOURCE_THRESH) {
			console.log(`
			Can't perform any post-login request ` + 
			`- Not enough API resources to run the monitor ` +
			`- returning from outerloop (try loop) now ` +
			`- error will be thrown when next calling callOrStopMainSequence. ` +
			`- please check your REST API capability and retry.`);
			return false; 
		}

		// ------------------------- 3) NON-LOGIN REQUEST (E.G: GET) --------------------------------
		console.log(`
		Post authentication, waiting ${DT_FIRST_REQ/(1000*60)}` +
		` min initially before triggering 1st dummy request...`); 
		await sleep(DT_FIRST_REQ); // 1. wait dtFirstReq ms
		
		// timestamping instant when the While loop is about to be executed
		let tsWhile = Date.now();

		// 2. perform the request as long as token is valid
		innerloop: while (tsWhile <= nextExpiration) {
			const dummyResponse = await api.performRequest(
				HTTP_METHOD,
				RESOURCE_TO_FETCH,
				{
					arena_session_id: api.token
				},
				DUMMY_REQUEST_TIMEOUT);
			
			// if performRequest did not resolve, .headers will break, hence the if
			if (dummyResponse) {
				const dummyResponseH = dummyResponse.headers;
				console.log(dummyResponseH);

				// DATA --> DATASTORE
				// Example of data to monitor at dummy request
				const monitoredDummyData = {
					'request_type' : 'GET/Dummy',
					'response_date' : dummyResponseH[FIELD1_TO_MONITOR],
					'remaining_calls' : dummyResponseH[FIELD2_TO_MONITOR]
				};
				database.insert(monitoredDummyData);
				if (DEBUG_DB) {
					console.log(`DB AT DUMMY DATA LOGGING: ${database}`);
				}
				

				// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
				// If not enough resources, break to avoid 429 too many requests
				API_CURRENT_RESOURCE = monitoredDummyData['remaining_calls'];
				if (DEBUG_RESOURCE) {
					console.log(`
					LATEST RESOURCE - LOG AT NON-LOGIN REQ: ${API_CURRENT_RESOURCE}`);
				}
				if (parseInt(API_CURRENT_RESOURCE) < MIN_RESOURCE_THRESH) {
					console.log(`
					Can't perform any more (non-login) dummy requests ` + 
					`- Not enough API resources to run the monitor ` +
					`- returning from innerloop (while loop) now ` +
					`- error will be thrown when next calling callOrStopMainSequence. ` +
					`- please check your REST API capability and retry.`);
					return false; 
				}
			}
			// Wait *DT_DUMMY_REQ* ms before next Non-Login Request
			await sleep(DT_DUMMY_REQ);
			// reassess `tsWhile` to keep running or stop while loop
			tsWhile = Date.now();
			if (DEBUG_TIMING) {
				console.log(`tsWhile value end of loop: ${tsWhile}`);
			}
		}
		// when a cycle: (auth + [req,...,req]) has completed, msg gets returned
		// msg is awaited at 1st mainSequence iteration
		// its reception conditions 2nd mainSequence execution
		// (see main function below)
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
	if (parseInt(API_CURRENT_RESOURCE) < MIN_RESOURCE_THRESH) {
		throw new Error(`
		!!!! Can't run mainSequence anymore due to `+
		`not enough API resources available `+`
		- please check your REST API capability and retry later.`);
	} else {
		console.log(`
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

	// Conditional 2nd run
	// CASE A: returned from 1st call with msg ---------------------------------------
	// > OK to proceed to automated monitoring + termination
	// > No more manual intervention needed!
	if (firstExecResult === 'completed_mainSeq_report') {
		console.log(`
		Successfully returned from very 1st mainSequence call: ` + `
		(msg received: ${firstExecResult}) running 2nd mainSequence now...`);
		
		let myIntervalAsync = setIntervalAsync(callOrStopMainSequence, DT_AUTH_CYCLE);
		callOrStopMainSequence(); //called in sync with myIntervalAsync
		
		// Timeout past *DT_MONITOR_SESS_AFT_FIRST_RUN*
		// `clearIntervalAsync` terminates the process (clean!).
		setTimeout ( _ => {
			console.log(`xxxxxxxxxxxxxxxx `+ 
			`Monitor session timing out now ` +
			`- clearing myIntervalAsync after last execution cycle ` + 
			`is complete. xxxxxxxxxxxxxxx`);
			clearIntervalAsync(myIntervalAsync);
		}, DT_MONITOR_SESS_AFT_FIRST_RUN);
	

	// CASE B: returned from 1st call... but without false bool or string ---------
	// then the error is not linked to a lack of API resource.
	} else if (firstExecResult && firstExecResult !== 'completed_mainSeq_report') {
		throw new Error(`
		!!!! Couldn't received completion message ` + 
		`from mainSequence - not due to lack of API resource. ` + 
		`Maybe check for syntax / main execution logics error?`);
	
	
	// CASE C: error due to lack of API resource -----------------------------------
	} else {
		throw new Error(`!!!! Couldn't loop callOrStopMainSequence `+
		`not enough API resources available `+`
		- please check your REST API capability and retry later.`);
	}
})();
// --------------------------------- END OF MONITOR EXECUTION CODE --------------------------------------