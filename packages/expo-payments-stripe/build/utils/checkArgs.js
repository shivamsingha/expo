import ReactPropTypesSecret from 'prop-types/lib/ReactPropTypesSecret';
export default function checkArgs(typeSpecs, values, location, componentName) {
    if (process.env.NODE_ENV !== 'production') {
        for (const typeSpecName in typeSpecs) {
            if (typeSpecs.hasOwnProperty(typeSpecName)) {
                const error = typeSpecs[typeSpecName](values, typeSpecName, componentName, location, typeSpecName, ReactPropTypesSecret);
                if (error instanceof Error) {
                    throw new Error(`Failed ${location} type: ${error.message}`);
                }
            }
        }
    }
}
//# sourceMappingURL=checkArgs.js.map