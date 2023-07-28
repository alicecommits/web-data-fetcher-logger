import axios from "axios"; 
import * as readline from 'node:readline/promises'; 
import { stdin as input, stdout as output } from 'node:process';

export class MyAPI
{
	// store future api keys into a 'token' attribute of instances of the MyAPI class
	constructor() {
		this.token = null; // will be updated with apiKey value
		this.URL = ''; // made as an attribute of MyAPI to be modified in apiConfig file
		// alternatively, can write 
		// const URL = "https://some-domain.com/api";
		// as a global constant at the top of this file.
	}
	async performRequest(
		httpVerb, 
		endpoint, 
		customHeaders, 
		reqTimeout, 
		someData = {}) {
		try { 
			// request timestamp (ts) - console logged but not stored
			let tsRequest = Date.now();
			console.log(`
			-------Timestamp: Request ( `
			 + httpVerb.toUpperCase() + endpoint + 
			` ) emitted at: ${new Date(tsRequest)}`);

			const response = await axios({
				method: httpVerb, //if unspecified, axios default is 'get'
				url: endpoint,
				baseURL: this.URL,
				headers: customHeaders,
				data: someData, 
				timeout: reqTimeout, 
			})		
			return response;
		}
		catch (error) {
			console.log(error);
		}
	};
};



// ------------------- Credentials util functions ------------------------
async function enterCredentials() {

	if (!enterCredentials.called) {

		enterCredentials.called = true; //to flag 1st time called
		const r1 = readline.createInterface({ input, output });

		const un = await r1.question('Enter username / email: ');
		const pw = await r1.question('Enter password: '); //TODO HIDE
		
		console.log(`User ${un} being logged...`);
		r1.close()
		
		return {
			username: un,
			password: pw
		};

	} else {
		return "credentials already set";
	}
};

// timing out user prompt, to guarantee no automatic call
// of the mainSequence will ever send `undefined` credentials
// to the API (which would lead to repeated failed login requests)
function noInputTimeout() {
	throw new Error(`
	user data not input or taking too long to process. ` +
	`Please re-log manually.`);
};
export async function enterCredentialsOrTimeoutAfter(ms) {
	
	// "TOP" synchronous with enterCredentials() call below
	const timeoutID = setTimeout(noInputTimeout, ms);
	// awaiting until completed or until timeout throws
	const successfulCred = await enterCredentials();
	
	// If user input its data in time, kill timer
	// to avoid unwanted error throwing!
	if (successfulCred) {
		clearTimeout(timeoutID); 
		return successfulCred;
	}
};
// ------------------- End of credentials util functions -----------------