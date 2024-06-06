import { clone, hash, HashString, Hashable, RelationMap, traverseDepthFirst, Assert, TypeEq, LiteralString } from "@shared-generic";

// type TExpression<CK extends string, TypeKey extends string, TypeConstants extends string,  T extends Hashable> = {[Key in TypeKey]: TypeConstants}  { [Key in CK]: T[] };

// type TExpression<CK extends string, T extends Hashable & { type: string } & { [Key in CK]: T[] }> = T;

type AlgOperation = {
    type: "plus" | "times" | "minus" | "divide" | "equals";
    children: AlgExpression[];
};

type AlgNumber = {
    type: "value";
    value: number;
    children: never[];
};

type AlgVariable = {
    type: "variable";
    // The variable name
    value: string;
    children: never[];
};

type AlgExpression = AlgOperation | AlgNumber | AlgVariable;

// Demonstrates the AlgExpression is non-empty
type Validate1 = Assert<AlgExpression extends never ? false : true>;

// Meets the type constraint
type Validate2 = Assert<AlgExpression extends TypedHashable & { children: AlgExpression[] } ? true : false>;

// Note, we need the object type here to rule out literals for the spread operation below. We also need to include Hashable to ensure that any properties with literal values are hashable literals.
type TypedHashable = object & Hashable & { type: string };

// CK stands for ChildrenKey
type SubObjectMaps<CK extends string, T extends TypedHashable & { [Key in CK]: T[] }> = {
    // Maps T to a canonical object in which the child objects been replaced by their hash strings.
    hashToTruncatedObject: Map<HashString, Omit<T, CK> & { [Key in CK]: HashString[] }>;

    // Goes from hashes without children to hashes with children. This facilitates wildcard matching.
    hashNoChildrenToHash: Map<HashString, Set<HashString>>;

    // Uses the hashes with children.
    parentChildRelation: RelationMap<HashString, HashString>;
};

const getEmptySubObjectMaps = <const CK extends string, T extends TypedHashable & { [Key in CK]: T[] }>(childrenKey: LiteralString<CK>): SubObjectMaps<CK, T> =>
    ({
        hashToTruncatedObject: new Map(),
        hashNoChildrenToHash: new Map(),
        parentChildRelation: new RelationMap(),
    } as SubObjectMaps<CK, T>);

// When mapping to a set, this lets you add a value inside a set, and when necessary initalize the set.
const mapAdd =
    <A, B>(map: Map<A, Set<B>>) =>
    (key: A, value: B) => {
        if (!map.get(key)) {
            map.set(key, new Set());
        }
        map.get(key)!.add(value);
    };

// This returns a function that assumes that the hashes of all children are already computed and stored in the nodeToHashes map.
const getTruncateChildren =
    <const CK extends string>(childrenKey: LiteralString<CK>) =>
    <T extends TypedHashable & { [Key in CK]: T[] }>(nodeToHashes: Map<T, HashString>) =>
    (node: T): Omit<T, CK> & { [Key in CK]: HashString[] } => {
        const children = node[childrenKey];

        const hashedChildren = children.map((child) => {
            const childHash = nodeToHashes.get(child);
            if (!childHash) {
                throw new Error("nodeToHashes argument was not correctly structured. Missing child hash");
            }
            return childHash;
        });

        return clone({ ...node, [childrenKey]: hashedChildren });
    };

const getSubObjectMaps =
    <const CK extends string>(childrenKey: LiteralString<CK>) =>
    <T extends TypedHashable & { [Key in CK]: T[] }>(root: T): SubObjectMaps<CK, T> => {
        const subObjectMaps = getEmptySubObjectMaps<CK, T>(childrenKey);

        const { hashToTruncatedObject, hashNoChildrenToHash, parentChildRelation } = subObjectMaps;

        // This is used to keep track of object references to the hashes. This is used to replace the children of each parent with a previously computed hash of the child. It is not returned by the function because it is only needed as an intermediate representation.
        const nodesToHashes: Map<T, HashString> = new Map();

        // We partially apply the arg It gets the hash and stores the mapping. uments since we'll only change which node is being passed in
        const truncateChildren = getTruncateChildren(childrenKey)(nodesToHashes);

        type TruncatedNode = ReturnType<typeof truncateChildren>;

        const updateMaps = (node: T, truncated: TruncatedNode) => {
            const nodeHash = hash(truncated);

            // Map the node in the original object to the hash
            nodesToHashes.set(node, nodeHash);

            // Map the hash to a uninque truncated object. This ensures that we have a single cannonical JS object reference for each sub-expression.
            hashToTruncatedObject.get(nodeHash) ?? hashToTruncatedObject.set(nodeHash, truncated);

            // We remove the children property to get the no children object
            let noChildren = clone(truncated) as Omit<T, CK>;
            delete truncated[childrenKey];

            // We hash the no children object
            const noChildrenHash = hash(noChildren);
            mapAdd(hashNoChildrenToHash)(noChildrenHash, nodeHash);
        };

        traverseDepthFirst(childrenKey)(root, (child, parent) => {
            if (!parent) {
                // The node without a parent is the root node, so it is already encoded from its children.
                return;
            }

            // Since it is depth first we can safely hash the node, knowing that any children it may have will have already been added to the nodesToHashes map.

            const childTruncated = truncateChildren(child);
            const childHash: HashString = hash(childTruncated);
            updateMaps(child, childTruncated);

            let parentHash: HashString;
            if (nodesToHashes.get(parent)) {
                parentHash = nodesToHashes.get(parent)!;
            } else {
                /// Parent hash has not yet been computed
                const childrenOfParent = parent[childrenKey];

                childrenOfParent.forEach((sibling) => {
                    // When we are looking at children of the parent (which are siblings or identical to the current child node). We know that any children of the children have already been hashed and added to the nodesToHashes since we are using depth first order.
                    const siblingTruncated = truncateChildren(sibling);
                    updateMaps(sibling, siblingTruncated);
                });

                // Now that we've ensured all the direct children of the parents have been hashed and added to nodesToHashes, we can hash the parent.
                const parentTruncated = truncateChildren(parent);
                updateMaps(parent, parentTruncated);
                // We just added the parent node to hash mapping in updateMaps, so now we get the parentHash
                parentHash = nodesToHashes.get(parent)!;
            }

            // We add the parentHash to ChildHash pair to our parent-child RelationMap
            parentChildRelation.addPair(parentHash, childHash);
        });

        return subObjectMaps;
    };
