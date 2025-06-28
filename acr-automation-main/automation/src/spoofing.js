const express = require("express");
const axios = require("axios");
const logger = require("./utils/logger.js")("spoofing");
const config = require("./utils/config.js");

const router = express.Router();
router.use(express.json());

/**
 * Forward the request to another url
 */
const forwardRequest = async (req, res, url) => {
    try {
        // Strip any artifacts from old headers
        delete req.headers["host"];
        delete req.headers["connection"];
        delete req.headers["content-length"];
        delete req.headers["content-type"];
        delete req.headers["accept"];

        const response = await axios({
            method: req.method,
            url: url,
            data: req.body,
            headers: req.headers
        });

        logger.debug(`Forwarded request to ${url}: ${JSON.stringify(response.data)}`);
        res.status(response.status).send(response.data);
    } catch (error) {
        logger.error(`Error forwarding request to ${url}: ${error.message}`);

        // Forward the error (if exists) back to the original client
        res.status(error.response ? error.response.status : 500).send(
            error.response?.data || { error: "Unknown error occurred" });
    }
};

/**
 * Spoof a device-info body
 */
const spoofDeviceInfo = data => {
    // Extract the profile from the config
    const profile = config.profile;

    // Syntactic sugar to return a components field value
    const getTemplateField = (component, field) => {
        return profile["template"][component][field];
    };

    // AI
    const changeThirdComponent = ip => ip.split('.').map((part, i) => i === 2 ? '1' : part).join('.');

    // AI
    function processMacAddress(input, profile) {
        // Extract the "macAddressFull" object
        let macAddress = input.macAddressFull;

        // Get the first network adapter (could be anything like 'Ethernet0', 'Ethernet', etc.)
        let firstAdapterKey = Object.keys(macAddress)[0]; // e.g., 'Ethernet0'
        let firstAdapter = macAddress[firstAdapterKey];

        // Update the "mac" field with the value from the profile
        firstAdapter.mac = profile.sp.mac_address.toLowerCase();

        // Update the "ipv4" field with the modified IP
        firstAdapter.ipv4 = changeThirdComponent(firstAdapter.ipv4);

        // Keep only the first network adapter and remove others
        let updatedMacAddress = {};
        updatedMacAddress[firstAdapterKey] = firstAdapter;

        // Return the updated object
        return updatedMacAddress;
    }

    data.macAddressFull = processMacAddress(data, profile);

    data["osVersion"] = getTemplateField("operating_system", "Version");
    data["systemSerial"] = getTemplateField("bios", "SerialNumber");
    data["uuid"] = profile["sp"]["computer_system_product_uuid"];
    if ("diskSerialNum" in data) {
        data["diskSerialNum"] = getTemplateField("disk_drive", "SerialNumber");
    }
    if ("macAddress" in data) {
        data["macAddress"] = "00:00:00:00:00:00";
    }
    if ("ipAddress" in data) {
        data["ipAddress"] = "127.0.0.1";
    }
    if ("cpuNum" in data) {
        data["cpuNum"] = getTemplateField("processor", "ProcessorId");
    }

    if ("cpuInfo" in data) {
        // AI
        const extractCpuCaptionDetails = input => {
            const match = input.match(/Family\s(\d+)\sModel\s(\d+)\sStepping\s(\d+)/);
            return match ? { family: match[1], model: match[2], stepping: match[3] } : null;
        };
        const captionDetails = extractCpuCaptionDetails(getTemplateField("processor", "Caption"));

        const formatValue = number => (number / 1000).toFixed(2);

        data["cpuInfo"] = {
            manufacturer: getTemplateField("processor", "Manufacturer") === "AuthenticAMD" ? "AMD" : "Intel",
            brand: getTemplateField("processor", "Name").trim(),
            vendor: getTemplateField("processor", "Manufacturer"),
            family: captionDetails.family,
            model: captionDetails.model,
            stepping: captionDetails.stepping,
            revision: (profile["template"]["processor"]["Revision"] || 0).toString(),
            voltage: "",
            speed: formatValue(getTemplateField("processor", "CurrentClockSpeed")),
            speedmin: "",
            speedmax: formatValue(getTemplateField("processor", "MaxClockSpeed")),
            cores: getTemplateField("processor", "NumberOfCores"),
            cache: {
                l1d: 0,
                l1i: 0,
                l2: getTemplateField("processor", "L2CacheSize"),
                l3: getTemplateField("processor", "L3CacheSize")
            },
        };
    }

    if ("memInfo" in data) {
        // AI
        const calculateTotalMemory = memoryArray => {
            return memoryArray.reduce((total, memory) => total + parseInt(memory.Capacity, 10), 0);
        };
        const totalMemory = calculateTotalMemory(profile["template"]["physical_memory"]);
        const usedMemory = data["memInfo"]["used"];

        data["memInfo"]["total"] = totalMemory;
        data["memInfo"]["free"] = totalMemory - usedMemory;
        // data.memInfo.used remains constant
        // data.memInfo.active remains constant
        data["memInfo"]["available"] = totalMemory - usedMemory;
    }

    if ("deviceInfoHasKey" in data) {
        data["deviceInfoHasKey"] = true;
    }
    if ("deviceInfoGet" in data) {
        data["deviceInfoGet"] = getTemplateField("processor", "ProcessorId");
    }

    logger.debug(`Spoofed device-info: ${JSON.stringify(data)}`);
    return data;
};

/**
 * Strip blacklisted processes
 */
const stripBlacklistedProcesses = processes => {
    // AI
    const blacklist = config["profile"]["process_blacklist"];
    return processes.filter(process =>
        !blacklist.some(pattern => new RegExp(pattern).test(process))
    );
};

router.post("/device-info", async (req, res) => {
    /**
     * if (arg.pid === "GET_DEVICE_INFO") {
     *       event.returnValue = deviceInfo
     * }
     *
     * to
     *
     * if (arg.pid === "GET_DEVICE_INFO") {
     *       request({
     *           url: "http://hlocalhost:2020/device-info",
     *           method: "POST",
     *           headers: {
     *               "Content-Type": "application/json"
     *           },
     *           body: deviceInfo,
     *           json: true
     *       }, (err, resp, body) => {
     *           event.returnValue = body
     *       })
     *   }
     */
    logger.info(`Endpoint /device-info called: ${JSON.stringify(req.body)}`);

    try {
        res.status(200).send(spoofDeviceInfo(req.body));
    }
    catch (e) {
        logger.error(`Error spoofing device info: ${e.message}`);
        // Send some invalid data to crash the client and prevent leak in case of an exception
        res.status(200).send({});
    }
});

router.post("/running-executables", async (req, res) => {
    /**
     * to
     *
     * function postRunningProcessData(_deviceInfo) {
     *   request({
     *       url: "http://hlocalhost:2020/running-executables",
     *       method: "POST",
     *       headers: {
     *           "Content-Type": "application/json",
     *           "Authorization": "Bearer " + global.accountInfo.internalToken,
     *           "RealUrl": main.skinInfo.host + "/frontend/running-executables",
     *       },
     *       cache: false,
     *       timeout: 3e4,
     *       body: _deviceInfo,
     *       json: true,
     *   }, (error, response, body) => {
     *       if (error) {}
     *       global.isSentRunningExeList = true;
     *   })
     * }
     */
    logger.info(`Endpoint /running-executables called: ${JSON.stringify(req.body)}`);

    const realUrl = req.headers["realurl"];
    delete req.headers["realurl"]; // Strip from original headers

    // Remove all blacklisted processes
    req.body = stripBlacklistedProcesses(req.body);

    logger.debug(`Spoofed running-executables: ${JSON.stringify(req.body)}`);
    await forwardRequest(req, res, realUrl);
});

router.post("/restricted-app", async (req, res) => {
    /**
     * function getRestrictedApps(_deviceInfo) {
     *   const headers = {
     *         "Accept": "...",
     *         "Content-Type": "application/json",
     *         "RealUrl": main.skinInfo.host + "/frontend/restricted-app"
     *   };
     *   if (typeof global.accountInfo != "undefined" && global.accountInfo !== null && typeof global.accountInfo.internalToken !== "undefined") {
     *       let token = global.accountInfo.internalToken;
     *       headers["Authorization"] = "Bearer " + token
     *   }
     *
     *   return new Promise(resolve => {
     *       request({
     *           url: "http://hlocalhost:2020/restricted-app",
     *           method: "POST",
     *           headers: headers,
     *           cache: false,
     *           timeout: 3e4,
     *           body: _deviceInfo,
     *           json: true
     *       }, (error, response, body) => {
     *           if (!error && response.statusCode == 200) {
     *               resolve(body)
     *           } else {
     *               resolve([])
     *           }
     *       })
     *   })
     * }
     */
    logger.info(`Endpoint /restricted-app called: ${JSON.stringify(req.body)}`);

    const realUrl = req.headers["realurl"];
    delete req.headers["realurl"]; // Strip from original headers

    // Remove all blacklisted processes
    req.body = stripBlacklistedProcesses(req.body);

    logger.debug(`Spoofed restricted-app: ${JSON.stringify(req.body)}`);
    await forwardRequest(req, res, realUrl);
});

module.exports = router;
