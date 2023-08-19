# **Alice's REST API monitor**
## **Outline**
customizable monitor to track the activity of a REST API
- requiring periodical (re-)authentication, using an API key - *this part can be adjusted or removed, depending on your API requiring (or not) authentication*
- logging the content of response status/data/headers, at **repeated regular time intervals**!

- to read about active TODOs --> [here](#todos)

## **Stack (#evolving atm)**
- Base language: JavaScript (ES6 syntax)
- Mock API used: https://dummyjson.com/
  - Notably, for auth: https://dummyjson.com/docs/auth - mocking auth with *id #29 (Macy): *username*: jissetts, *password*: ePawWgrnZR8L*
- [**axios**][1]: promise-based HTTP Client for node.js and the browser, supported at the time of first push to this repo (early 2023)
- [**node:readline/promises** + **node:readline/process**][2]: Node.js package to create an interface in the CLI. Used to prompt the user API authentication credentials in this project. Supported in early 2023.
- [**set-interval-async**][3]: Package aiming at replicating JavaScript's in-built `setInterval`, but optimized for a use with asynchronous functions, such as functions written to fetch data from a server.
- [**nedb**][4]: TODO change - embedded persistent or in memory database for Node.js, nw.js, Electron and browsers, 100% JavaScript, no binary dependency. API is a subset of MongoDB's. In early 2023, the library is however no longer maintained. For now, it serves as an alternative to writing data to a .csv and will be tried as the database tech when the project grows and requires setting up a server for live monitoring purposes, showing dynamically refreshed graphs on the client side.

[1]: https://axios-http.com "axios doc"
[2]: https://nodejs.org/api/readline.html "node.js readline doc"
[3]: https://github.com/ealmansi/set-interval-async "set-interval-async github"
[4]: https://github.com/louischatriot/nedb "NedB github"

## **How to use**
### Conventions used in the documentation:
In what follows we will use the following:
 - *dummyReq(uest)* : refers to the request chosen by the user, after authentication request has been completed successfully (if any needed). A generic example of a `GET/Dummy` request is taken for the code demo.
 - *loginReq(uest)* : refers to the request (http method + endpoint) needed to authenticate (if any needed)
 - *Auth* : abbreviated *Authentication*
 - "top": refers to the instant a timestamp is taken to start a timer, interval, period calculation.
### **In `main.mjs`, set the following**
- **Monitor settings** section:
  - **API general access**
    - *API_URL*: URL of your API (e.g.: https://some-domain.com/api)
    - *API_ENV*: any extra field needed to reach the API (e.g: environment/world/community id...)
  - **API resource handling**
    - *API_CURRENT_RESOURCE*: when setting the value for the first time, set it at least to the maximum resource or rate allowed by your API (e.g: calls/seconds or calls/day, request size/day). Check your REST API doc to know when or how you could maxed out.
    - *MIN_RESOURCE_THRESH*: threshold under which the monitor execution should be stopped. The strategy needs to be set by user, given *API_CURRENT_RESOURCE* above. E.g. when reaching 1000 calls left, stop the monitor.
  - **Request settings > which request are we sending?**  
  This part is to set the request to be sent post-authentication, or right away if no authentication is required. 
    - *HTTP_METHOD*: http method ('get', 'post', etc.)
    - *RESOURCE_TO_FETCH*: the endpoint that contains the data you wish to monitor
    - *DEFAULT_HEADERS*: the headers to send by default at any request to your API. Note: may differ depending on HTTP method/endpoint (e.g: for login, or posting/fetching file content)
  - **Request settings > timeouts (ms)**
    - *LOGIN_REQUEST_TIMEOUT*: if no response, after how many milliseconds the loginRequest is aborted
    - *DUMMY_REQUEST_TIMEOUT*: if no response, after how many milliseconds the dummyRequest is aborted
  - **Response settings: which fields are we interested in?**  
    - *FIELD1_TO_MONITOR* + *FIELD2_TO_MONITOR*: This part is to set the name(s) of the response (data/header/status) fields, that you wish to fetch and log.  
    - Needs to be adjusted alongwith the `monitored...Data` objects defined in the body of `mainSequence`, depending on the JSON path at which the fields of interest are located in the response object: response.data, response.headers, response.status... sometimes a mixture of those.
    - *RESOURCE_KEY*: The field where to find the info on the resource limited by the user via the threshold *MIN_RESOURCE_THRESH*.
    - For more info on how to configure axios response objects, check the doc: https://axios-http.com/docs/res_schema 
  - **Monitor time settings (ms)** - *arbitrary values set in the script*
    - *USER_CREDENTIALS_TIMEOUT*: in case API (re-)authentication is required, if the credentials take too long to be prompted or injected then the following error is thrown: `"user data not input or taking too long to process. Please re-log manually."`, making the monitor quit (see `enterCredentialsOrTimeoutAfter` in `apiUtils.mjs`).
    - **Monitor cycling settings**
      - *DT_FIRST_REQ*: duration between auth response and 1st non-login request
      - *DT_DUMMY_REQ*: duration between a non-login resp and the next non-login req trigger
      - *DT_AUTH_CYCLE*: duration between each (Auth endpoint + Dummy req) complete cycle 
      - *DT_MONITOR_SESS_AFT_FIRST_RUN*: duration of 1 cycle + monitoring session. Used to guarantee **the monitor will eventually quit** "gracefully", either by clearing `setIntervalAsync` with `clearIntervalAsync` at the end of a monitoring session, or with *API_CURRENT_RESOURCE* returning after falling below *MIN_RESOURCE_THRESH*. #TODO max retry

    **Important notes regarding monitor cycling settings**
    - ideally *DT_AUTH_CYCLE* should be set = or slightly < to your API token validity period, to limit the frequence of token re-generation
    - if *DT_AUTH_CYCLE* > validity period, you run the risk of sending a non-login request with an invalid token, which will cause an error 401 Unauthorized. To know your API token validity period, check your REST API doc.
    - setting *DT_AUTH_CYCLE* as an exact multiple of *DT_DUMMY_REQ* can cause the latest non-login request to overlap with authentication renewal, which can lead to accidentally send a non-login request with a no longer valid token (error 401 Unauthorized).
    - ideally, *DT_AUTH_CYCLE* should be spaced in time from the latest request, and made a little higher than - but not exactly - the multiple of *DT_DUMMY_REQ*
    - *DT_MONITOR_SESS_AFT_FIRST_RUN* corresponds to how long you want your monitoring session to last. Ideally, should be the longest duration of all.  - e.g. for a 16-hour-long monitoring session, say from 8AM to 8PM : `12(h)*60(min)*60(s)*1000(ms)`.  
    *Note: DT_MONITOR_SESS_AFT_FIRST_RUN can be set shorter than DT_AUTH_CYCLE safely, but doing this does not present much interest.*
    - **For rationales behind this logics, read the Cycling strategy section below.**

### **(If needed) In `apiUtils.mjs`, tweak the following**  
  

- **`performRequest`**: 

  - `performRequest` is a wrapper function around axios request config. It also console logs the request HTTP METHOD/endpoint + timestamp at request emitting. **The intent in `apiUtils.mjs` is to be a template for a typical request configuration**.
  - If the configuration is OK as is for you, then you just need to modify the http method/endpoint in your .env (see `example_dotenv.env`). If not, then in `apiUtils.mjs > performRequest`, restructure the object in `axios()` method.

  - **Parameters you might wish to modify `performRequest` to be modified by the user of the monitor - see settings in the monitor settings of `main.mjs`**
	 - `customHeaders`: headers to send to the API (see your REST API documentation if needed)
	 - `reqTimeout (ms)`: request timeout
	 - `someData`: data to send in the body of the request.  

	*Note if you're unfamiliar with RESTful APIs: someData can only be NON empty for the following http methods (httpVerb):	'PUT', 'POST', 'DELETE', and 'PATCH'. 
	If not specified, someData is sent as empty body to the REST API (e.g. for a 'GET')*
- **Important**: If you're unfamiliar with http requests, before doing anything in `apiUtils.mjs`, it is recommended to check axios documentation for request configuration, notably regarding http methods, authentication, encoding, specific content type: https://axios-http.com/docs/req_config
- **`enterCredentials`**:  
  - The example used in `apiUtils.mjs` is based on a typical situation where, to authenticate to the API, the user would likely need to enter a username/email + a password.
  - If your API works differently, adjust const names/prompt instructions to display.

## **Motivations + Rationales**
### **Cycling strategy**
Choosing cycles starting with auth then fetch dummy was motivated by **providing flexibility in requesting choices & strategy, depending on your use case**. The data of interest for you could vary from simple `response.status`, `response.headers`, to more complex `response.data`. 



### **Exception / Error handling**
The error handling strategy for this monitor was designed with the following in mind:
- Unsuccessful non-authentication requests shouldn't materialize as unhandled rejection that throws to the CLI, they should be caught (note: but too many retires should be handled --> in my TODOs list at the bottom).

- Empty credentials shouldn't accidentally be sent to the server, otherwise error 401 will occur. To mitigate this, the choice was taken to set a (realistic) limit to the duration available to the user to input their data, or for the monitor to re-inject credential data. If timeout happens, then the monitor quits and the user has to input their data again. If credentials are set but invalidated, error will be thrown as well.

- **The monitor execution should be guaranteed to quit eventually, as "gracefully" as possible**. The possible scenarios envisioned at the time of programming are:
  - a progressive ending, via termination of the async interval using `clearIntervalAsync`
  - an aborted execution due to not enough API resources available (or falling under user-defined's threshold). 

  *Note: For the latter, the choice was made to `return false;` either at auth or dummy request step, rather than using `break (outer|inner)loop;`. `return` will stop the execution of `mainSequence` rather than exiting inner/outer loops, which was the prefered behaviour.*

  - Once returned from `mainSequence`, the async interval is still running and needs to be interrupted. For this, the next `callOrStopMainSequence` call will throw an error, which "globally" quits the monitor execution.    

**Some #TODOs I'm aware of, that remain regarding some NOK HTTP statuses => see #TODOs section at the bottom**

### **Step-by-step execution handling in main**
The design of the final `main` function (IIFE) itself was thought for smooth progression into the monitor looped execution, with rigour:
  1. **For the very 1st monitor execution, `callOrStopMainSequence` is called and awaited.**
     - 1.a. if there aren't enough resources to proceed to more calls, then the error is thrown there.
     - 1.b. if there are, then `STARTING A MAIN SEQUENCE RUN` logs in the CLI and `mainSequence` is awaited, and returned from.
  2. (a) If 1.a. was successful, then `msg = completed_mainSeq_report` must have been returned from it, which conditions 2nd `callOrStopMainSequence` execution. **At that stage, and not before, `setIntervalAsync` is called synchronously with the 2nd call that got fed credentials automatically**. This way, the interval "top" and the credentials input happen almost simultaneously, unlike at the 1st execution, where manual user credential input takes a little longer (and would get the cycle to finish early because started too late w.r.t. interval "top").
     - 2.b: if there is a result returned but it does not evaluate to `false` and it isn't `msg`, then there must be a non-API-resource-related error
     - 2.c: else, not enough API resource error is thrown.  

### **`main` flowchart overview**

Below flowchart represents a high-level overview of the cycling strategy, along with the different steps of error handling

```mermaid

graph TD;
id0(((callOrStopMainSequence)))
id1000[mainSequence credentials eval]
H(((return from while with msg)))
id98["log monitoredLoginData"]
id99["log monitoredDummyData"]
id1[(myTrackedData.db)]
id2{tsWhile <= nextExpiration ?}
A["outerloop: try"]
B["auth (post/login)"]
C["top token validity start"]
D[" nextExpiration calculation"]
G["top innerloop: while"]
F["perform request e.g get/dummy"]

EH0["throw Error (not enough API resource at callOrStopMainSequence)"]
style EH0 fill:#DE532D,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

EH1["throw Error - noInputTimeout"]
style EH1 fill:#DE532D,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5
EH2["catch (from outerloop: try/catch block)"]
style EH2 fill:#C17D39,stroke:#fff,stroke-width:2px,color:#fff,stroke-dasharray: 5 5
EH3["catch (from try/catch axios wrapper)"]
style EH3 fill:#C17D39,stroke:#fff,stroke-width:2px,color:#fff,stroke-dasharray: 5 5
EH4["catch (from try/catch axios wrapper)"]
style EH4 fill:#C17D39,stroke:#fff,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

EH5["return false (not enough API resource at get/dummy)"]
style EH5 fill:#C67,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5
EH6["return false (not enough API resource at auth)"]
style EH6 fill:#C67,stroke:#f66,stroke-width:2px,color:#fff,stroke-dasharray: 5 5

    id0-->id1000
    id0-.-oEH0
    id1000-->|inject stored credentials| A
    id1000-.-oEH1
    A-->B
    A-.-oEH2
    B-->C
    B-.-oEH3
    B-.-oEH6
    B-->id98
    id98-->id1
    C-->D
    C-->|sleep DT_FIRST_REQ| G
    D-->id2
    G-->id2
    id2-->|Yes| F
    F-.-oEH4
    F-.-oEH5
    F-->id99
    id99-->id1
    F-->|sleep DT_DUMMY_REQ| id2
    id2-->|No| H
    H-. async interval every DT_AUTH_CYCLE .-> id0

```
  
## **Plotting logged data**
You can choose to plot the data using an in-memory database, or having a database on your backend from where you query the data and displays it in an app. 

## **TODOs**

If you wish to contribute to them, feel free to do so!
- [ ] **#TODO Handling `429 Too Many Requests`** - see TODO
  - Sometimes, API rate is high, resources decrease faster than expected, leading to `429 Too Many Requests` triggering BEFORE entering `API_CURRENT_RESOURCE < MIN_RESOURCE_THRESH` condition.   
  - In this case, the `try/catch` structure of `performRequest` in `apiUtils.mjs` applies and so `429 Too Many Requests` is caught as an `AxiosError` exception. A quick correction would be to handle `429 Too Many Requests` so that monitor aborts and totally quits.  

- [ ] **#TODO Handling `401 Unauthorized`**: Need to implement retry strategy
- [ ] manage node modules ? they're git ignored for now
- [ ] try the "module pattern" from MDN doc on IIFE
- [ ] password hiding feature in `enterCredentials`

Mid/Long-term, will happen incrementally:
- [ ] TDD: Write tests notably for:
  - valid/invalid credentials feature
  - *TBA*
- [ ] migrate to a server/client structure to evolve towards a **live monitor + auto-refresh of data logging/graphs**, notably handling the following:
  - CORS
  - database querying
  - Plot refreshing in the browser (real-time)
  - JS-based interactive plotting, in the browser  

- [ ] migrate JS --> TypeScript

<p align="right">(<a href="#top">back to top</a>)</p>