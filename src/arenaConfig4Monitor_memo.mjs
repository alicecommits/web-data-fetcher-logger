// Setting up the nedb database
//replace with whatever name.db
const database = new Datastore('ArenaRemainingCalls.db');
database.loadDatabase();

// ------------------------- MONITOR SETTINGS ------------------------------------
// API properties // e.g. --------------------------------------------------------


// API general access
const API_URL = "https://api.arenasolutions.com/v1"; // https://some-domain.com/api
const API_ENV = "897380659"; // environment/world/community id...

// API resource handling
let API_CURRENT_RESOURCE = 10000000; // init with arbitrary number >= max resource
const MIN_RESOURCE_THRESH = 0; // reaching e.g. 1000 calls left, stop monitor

// Request settings > which request are we sending? // GET/someDummyResource
const HTTP_METHOD = 'get';
const RESOURCE_TO_FETCH = '/items?number=FFFA001354';
const DEFAULT_HEADERS = {'Content-Type': "application/json"};
// Request settings > timeouts (ms)
const LOGIN_REQUEST_TIMEOUT = 20*1000;
const DUMMY_REQUEST_TIMEOUT = 10*1000;

// Response settings: which fields are we interested in?
const FIELD1_TO_MONITOR = 'date'; //e.g. date
const FIELD2_TO_MONITOR = 'x-arena-requests-remaining'; //e.g. the qty of something
const RESOURCE_KEY = 'remaining_calls' //e.g. the API rate

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

//LOGIN
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


api.token = loginResponse.data.arenaSessionId;

// For example: monitoring headers at login
const loginResponseH = loginResponse.headers;
console.log(loginResponseH);

// DATA --> DATASTORE
// Example of data to monitor at login
const monitoredLoginData = {
    'request_type' : 'POST/Login',
    'response_date' : loginResponseH[FIELD1_TO_MONITOR],
    'remaining_calls' : loginResponseH[FIELD2_TO_MONITOR]
}; 

// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// If not enough resources, return to avoid 429 too many requests
API_CURRENT_RESOURCE = monitoredLoginData['remaining_calls'];

//DUMMY
const dummyResponse = await api.performRequest(
    HTTP_METHOD,
    RESOURCE_TO_FETCH,
    {
        arena_session_id: api.token
    },
    DUMMY_REQUEST_TIMEOUT);


const dummyResponseH = dummyResponse.headers;
    console.log(dummyResponseH);

    // DATA --> DATASTORE
    // Example of data to monitor at dummy request
    const monitoredDummyData = {
        'request_type' : 'GET/Dummy',
        'response_date' : dummyResponseH[FIELD1_TO_MONITOR],
        'remaining_calls' : dummyResponseH[FIELD2_TO_MONITOR]
    };

// !!!!!!!!!!!!!!!!!!!!  API resource handling !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
// If not enough resources, return to avoid 429 too many requests
API_CURRENT_RESOURCE = monitoredDummyData['remaining_calls'];