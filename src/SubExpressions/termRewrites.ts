import { clone, hash, HashString, Hashable, RelationMap, traverseDepthFirst, Assert, TypeEq } from "@shared-generic";

// type TExpression<ChildrenKey extends string, TypeKey extends string, TypeConstants extends string,  T extends Hashable> = {[Key in TypeKey]: TypeConstants}  { [Key in ChildrenKey]: T[] };

type TExpression<ChildrenKey extends string, T extends Hashable & { type: string } & { [Key in ChildrenKey]: T[] }> = T;

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

// IF Alg Expression is not a valid T Expression this will throw and error.
type AlgTExpression = TExpression<"children", AlgExpression>;

// Demonstrates the AlgExpression and AlgTExpression are equivalent types
type Validate = Assert<TypeEq<AlgExpression, AlgTExpression>>;

type SubObjectMaps<ChildrenKey extends string, T extends Hashable & { [Key in ChildrenKey]: T[] }> = {
    // Maps T to a canonical object in which the child objects been replaced by their hash strings.
    hashToTruncatedObject: Map<HashString, Omit<T, ChildrenKey> & { [Key in ChildrenKey]: HashString[] }>;

    // Goes from hashes without children to hashes with children. This facilitates wildcard matching.
    hashNoChildrenToHash: Map<HashString, Set<HashString>>;

    // Uses the hashes with children.
    parentChildRelation: RelationMap<HashString, HashString>;
};

const getEmptySubObjectMaps = <ChildrenKey extends string, T extends { [Key in ChildrenKey]: T[] }>(): SubObjectMaps<ChildrenKey, T> =>
    ({
        hashToTruncatedObject: new Map(),
        hashNoChildrenToHash: new Map(),
        parentChildRelation: new RelationMap(),
    } as SubObjectMaps<ChildrenKey, T>);

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
    <ChildrenKey extends string>(childrenKey: ChildrenKey) =>
    <T extends { [Key in ChildrenKey]: T[] }>(nodeToHashes: Map<T, HashString>) =>
    (node: T): Omit<T, ChildrenKey> & { [Key in ChildrenKey]: HashString[] } => {
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
    <ChildrenKey extends string>(childrenKey: ChildrenKey) =>
    <T extends { [Key in ChildrenKey]: T[] }>(root: T): SubObjectMaps<ChildrenKey, T> => {
        const subObjectMaps = getEmptySubObjectMaps<ChildrenKey, T>();

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
            let noChildren = clone(truncated) as Omit<T, ChildrenKey>;
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

// type ExpressionTree<ChildrenKey extends string = "children"> = Hashable & { [Key in ChildrenKey]: ExpressionTree<ChildrenKey>[] }

// const subExpressions =
//     <ChildrenKey extends string, T extends ExpressionTree<ChildrenKey>>(childrenKey: ChildrenKey) =>
//     (object: T, excludeKeys: string[] = []) => {
//         const noChildrenHashToChildrenHash: Map<string, Set<string>> = new Map();
//         const childrenHashToObject: Map<string, T> = new Map();
//         const parentChild : RelationMap<

//         // The type of the object after children are replaced by hashes.
//         type HashedChildren = Omit<T, ChildrenKey> & { ChildrenKey: string[] };

//         function inner(object: T) {
//             const hashSubExpression = (object: Hashable) => hash(object);
//             const hashNoChildren = (object: Hashable) => hash(object, [childrenKey, ...excludeKeys]);

//             const children = object[childrenKey];

//             children.map((child) => {
//                 if (child[childrenKey])

//             });
//         }
//     };
