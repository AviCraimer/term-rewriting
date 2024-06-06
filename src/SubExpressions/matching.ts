import { MultiGraph } from "../../../shared-generic/src/DataStructures/GraphStructures/MultiGraph";

// From the root, we can have descending edges for each type in the expression tree.

// We need a way to deal with values as well.

// Either we have a "value" key as well as children key and type key.

type KeysConstraint = {
    childrenKey: string;
    typeKey: string;
    valueKey: string;
};

const defaultKeys = {
    childrenKey: "children",
    typeKey: "type",
    valueKey: "value",
} as const;

// This function infers the constants from an object just as example of how the keys might be inferred from user provided config.
const keysHelper = <const K extends KeysConstraint = typeof defaultKeys>(keys: K = defaultKeys as K): K => {
    return keys;
};

const sdsd = keysHelper({ childrenKey: "components", typeKey: "operation", valueKey: "data" });

/**
    Edges are the types | child indexes | "value" | values |

    Nodes - OR, AND, TERMINATE


 */
