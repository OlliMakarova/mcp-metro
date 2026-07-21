# Goal
Write the code for MCP server tools that implement retrieving the current cross-rate for a specified pair of currencies.

## Instructions

### Currency Cross-Rate API

#### Available Currencies
Currency codes (ISO 4217 code Alpha-3): ALL, ARS, AUD, BGN, BRL, BYN, CAD, CHF, CLP, CNY, CZK, DKK, EUR, GBP, HKD, HRK, HUF, IDR, INR, ISK, JOD, JPY, KRW, KZT, LAK, LKR, MKD, MMK, MXN, MYR, NOK, NPR, NZD, PHP, PLN, RON, RSD, RUB, SEK, SGD, THB, TRY, TWD, UAH, USD, VND, ZAR

#### Endpoint

```http request
GET http://<appConfig.accessPoints.currencyService.host>:<appConfig.accessPoints.currencyService.port>/currency-service/?rate=<QUOTE_CURRENCY><BASE_CURRENCY>
Authorization: Bearer <appConfig.accessPoints.currencyService.token>
```

Example:

```http request
GET http://smart-trade-ml.com:5001/currency-service/?rate=THBRUB
Authorization: Bearer <appConfig.accessPoints.currencyService.token>
```

Response:

```json
{"symbol": "THBRUB", "rate": 2.424167346170733}
```

Possible error codes: 400, 401, 404, 502

### Addition to config/default.yaml

```yaml
accessPoints:
  currencyService:
    host: smart-trade-ml.com
    port: 5002
    token: '***'
```


### Create config/local.yaml

Create a file config/local.yaml with the following content:

```yaml
---
accessPoints:
   currencyService:
      token: '88888888-4444-4444-4444-bbbbbbbbbbbb'

agentTester:
   enabled: true
   openAi:
      apiKey: '<ask the user for the key>'

consul:
   service:
      enable: false

webServer:
   auth:
      enabled: true
      jwtToken:
         encryptKey: 'dbbe87db-90d0-4732-aae3-4089763ec392'
         checkMCPName: true
         isCheckIP: false
      permanentServerTokens: ['psToken1']

adminPanel:
   enabled: true
   authType: 'permanentServerTokens'
```

# Task

1) Instead of the test tool 'example_tool', add a tool to get the current currency cross-rate.
   Tool parameters:
- quoteCurrency - Currency code (ISO 4217 code Alpha-3) - required parameter
- baseCurrency - Currency code (ISO 4217 code Alpha-3) - optional parameter, default is USD

2) Instead of the test resource 'custom-resource://resource1', add a resource to get the list of available currencies

3) Instead of the endpoint /api/example (/example) in the file `src/api/router.ts`, create the endpoint get-curr-rate as a proxy to http://<appConfig.accessPoints.currencyService.host>:<appConfig.accessPoints.currencyService.port>/currency-service/?rate=<QUOTE_CURRENCY><BASE_CURRENCY>

4) Replace file content `src/asset/logo.svg` with
```
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="currentColor"
      d="M12 14.4q-.8 0-1.4-.6l-.3-.3H10l-1 1v.2l.3.3q.7.8 1.9 1v1l.1.2h1.4l.2-.1v-1q2-.4 2.1-2.2c0-1.8-1.5-2.3-2.5-2.6-1.3-.4-1.5-.5-1.5-1s.8-.6 1.3-.6q.7 0 1.3.4l.3.2h.3l.7-1.3v-.2l-.4-.2Q13.8 8 13 8V7l-.2-.1h-1.4l-.1.2v1q-1.9.6-2 2.2c0 1.9 1.8 2.4 2.7 2.7q1.6.4 1.4.9c0 .4-.8.5-1.2.5m10 .2-.7-.1-.7.3a8.6 8.6 0 0 1-10.9 5.6c-2.8-1-5-3.2-5.7-6l1.7.8q.5.2.8-.3l.3-.5-.3-.8-3.7-2a1 1 0 0 0-.8.4l-2 3.7.3.8.6.3q.5.2.8-.3l.7-1.3A10.4 10.4 0 0 0 17 21.5q3.8-2 5.2-6.1a1 1 0 0 0-.4-.8M24 8q0-.3-.3-.4l-.6-.3-.8.3-.7 1.3A10.4 10.4 0 0 0 7 2.7a10 10 0 0 0-5.2 6q-.2.6.4.8l.6.2q.5.1.7-.4a8.6 8.6 0 0 1 10.9-5.6 9 9 0 0 1 5.7 6.1L18.3 9l-.8.3-.3.5.3.8 3.7 2 .8-.3 2-3.8z"/>
</svg>
```

5) Formulate the prompt AGENT_BRIEF in `src/prompts/agent-brief.ts` and AGENT_PROMPT in `src/prompts/agent-prompt.ts`

6) Instead of the test examples in `tests/mcp/test-cases.js`, write tests for our case

7) Update the README.md to reflect the new project. This README.md will be used when searching for this MCP in the RAG system.
   Therefore, describe the essence of the tool, its features, how to install, a list of tools, resources, prompts. Briefly and to the point.
