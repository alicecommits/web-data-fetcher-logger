import * as readline from 'node:readline/promises'; 
import { stdin as input, stdout as output } from 'node:process';

async function enterCredentials() {

	if (!enterCredentials.called) {

		enterCredentials.called = true; //flags 1st time called
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

// timing out user prompt, to prevent sending `undefined` credentials
function noInputTimeout() {
	throw new Error(`
	user data not input or taking too long to process. ` +
	`Please re-log manually.`);
};
export async function enterCredentialsOrTimeoutAfter(ms) {
	
	const timeoutID = setTimeout(noInputTimeout, ms);
	const successfulCred = await enterCredentials();
	
	// If user input its data in time, kill timer
	// to avoid unwanted error throwing!
	if (successfulCred) {
		clearTimeout(timeoutID); 
		return successfulCred;
	}
};