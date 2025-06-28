#pragma once
#include "Patcher/Patcher.hpp"

#include <array>

static constexpr std::array<patcher::Descriptor, 3> kPatchesDeviceInfo
{
    patcher::Descriptor {patcher::Type::ReplaceOne,
        R"(if(arg.pid==="GET_DEVICE_INFO"){event.returnValue=deviceInfo})",
        R"(if(arg.pid==="GET_DEVICE_INFO"){request({url:"http://localhost:2020/device-info",method:"POST",headers:{"Content-Type":"application/json"},body:deviceInfo,json:true},(err,resp,body)=>{event.returnValue=body})})",
    },

    patcher::Descriptor {patcher::Type::ExplicitFunction,
        "postRunningProcessData",
        R"({
request({
  url: "http://localhost:2020/running-executables",
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + global.accountInfo.internalToken,
    "RealUrl": main.skinInfo.host + "/frontend/running-executables",
  },
  cache: false,
  timeout: 3e4,
  body: _deviceInfo,
  json: true,
}, (error, response, body) => {
  if (error) {}
  global.isSentRunningExeList = true;
})
})"
    },

    patcher::Descriptor {patcher::Type::ExplicitFunction,
        "getRestrictedApps",
        R"({
const headers = {
  "Accept": "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "RealUrl": main.skinInfo.host + "/frontend/restricted-app"
};
if (typeof global.accountInfo != "undefined" && global.accountInfo !== null && typeof global.accountInfo.internalToken !== "undefined") {
  let token = global.accountInfo.internalToken;
  headers["Authorization"] = "Bearer " + token
}

return new Promise(resolve => {
  request({
    url: "http://localhost:2020/restricted-app",
    method: "POST",
    headers: headers,
    cache: false,
    timeout: 3e4,
    body: _deviceInfo,
    json: true
  }, (error, response, body) => {
    if (!error && response.statusCode == 200) {
      resolve(body)
    } else {
      resolve([])
    }
  })
})
})"
    }
};
