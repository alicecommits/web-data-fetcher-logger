import axios from "axios"; 


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
			// request timestamp - console logged but not stored
			let tsRequest = Date.now();
			console.log(`
			-------Timestamp: Request ( `
			 + httpVerb.toUpperCase() + endpoint + 
			` ) emitted at: ${new Date(tsRequest)}`);

			const response = await axios({
				method: httpVerb, //default: get
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