import { PiiScanner, PII_PATTERNS } from "./sdks/typescript/src/server/pii";

const scanner = new PiiScanner([
    PII_PATTERNS.EMAIL,
    PII_PATTERNS.IP_ADDRESS,
    PII_PATTERNS.CREDIT_CARD,
    '"ssn":',
    '"password":',
    '"id":',
]);

const inputStr = "{\"total_records\":12,\"sample_keys\":[\"id\",\"age\",\"condition\",\"riskScore\",\"lastVisit\"],\"first_sample\":[{\"id\":\"P001\",\"age\":65,\"condition\":\"Hypertension\",\"riskScore\":0.85,\"lastVisit\":\"2025-01-15T10:00:00Z\"}]}";

console.log("String check:", scanner.scan(inputStr));

const inputObj = {
    content: [
        { type: "text", text: inputStr }
    ]
};

console.log("Object check (String inside array):", scanner.scan(inputObj));

const nativeObj = {
    content: [
        {
            type: "text",
            text: {
                total_records: 12,
                first_sample: [
                    { id: "P001", age: 65 }
                ]
            }
        }
    ]
};

console.log("Object check (Native Object):", scanner.scan(nativeObj));

// Let's simulate Phase 31: Native Serialization
const stringifiedNativeObj = {
    content: nativeObj.content.map(item => {
        if (item.type === "text" && typeof item.text === "object") {
            return {
                ...item,
                text: JSON.stringify(item.text)
            };
        }
        return item;
    })
};

console.log("Object check (Phase 31 Stringified Native Object):", scanner.scan(stringifiedNativeObj));
