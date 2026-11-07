import assert from "node:assert/strict";
import test from "node:test";
import { ObjectManager } from "./objectManager.js";

test("object grid placement matches overlap checks at edges and across the map", () => {
    const config = { mapScale: 1000, colGrid: 10 };
    const manager = new ObjectManager(null, [], {}, config, [], null);
    const cases = [
        [0, 0, 0],
        [100, 100, 0],
        [100, 100, 10],
        [500, 500, 200],
        [1000, 1000, 40],
        [-20, 1020, 10]
    ];

    for (let i = 0; i < 100; i++) {
        cases.push([
            (i * 137) % 1080 - 40,
            (i * 223) % 1080 - 40,
            (i * 17) % 180
        ]);
    }

    for (const [x, y, scale] of cases) {
        const obj = { x, y, scale, gridLocations: [] };
        const expected = [];
        const objX = Math.min(config.mapScale, Math.max(0, x));
        const objY = Math.min(config.mapScale, Math.max(0, y));
        const cellSize = config.mapScale / config.colGrid;

        for (let gridX = 0; gridX < config.colGrid; gridX++) {
            for (let gridY = 0; gridY < config.colGrid; gridY++) {
                if (objX + scale >= gridX * cellSize &&
                    objX - scale <= (gridX + 1) * cellSize &&
                    objY + scale >= gridY * cellSize &&
                    objY - scale <= (gridY + 1) * cellSize) {
                    expected.push(gridX + "_" + gridY);
                }
            }
        }

        manager.setObjectGrids(obj);
        assert.deepEqual(obj.gridLocations, expected, `grid placement for ${x}, ${y}, scale ${scale}`);
    }
});

test("clears only the requesting player's placed buildings", () => {
    const manager = new ObjectManager(null, [], {}, { mapScale: 1000, colGrid: 10 }, [], null);
    const owner = {
        sid: 1,
        pps: 0,
        itemCounts: { 1: 1 },
        changeItemCount(groupId, amount) {
            this.itemCounts[groupId] = (this.itemCounts[groupId] || 0) + amount;
        }
    };
    const otherOwner = { sid: 2 };
    const ownedBuilding = {
        sid: 10,
        active: true,
        owner,
        group: { id: 1, place: true },
        gridLocations: []
    };
    const ownedNonBuilding = {
        sid: 11,
        active: true,
        owner,
        group: null,
        gridLocations: []
    };
    const otherBuilding = {
        sid: 12,
        active: true,
        owner: otherOwner,
        group: { id: 1, place: true },
        gridLocations: []
    };
    manager.objects.push(ownedBuilding, ownedNonBuilding, otherBuilding);
    const removedPackets = [];
    const server = { broadcast: (...packet) => removedPackets.push(packet) };

    const removed = manager.removePlayerBuildings(owner, server);

    assert.equal(removed, 1);
    assert.equal(ownedBuilding.active, false);
    assert.equal(ownedNonBuilding.active, true);
    assert.equal(otherBuilding.active, true);
    assert.deepEqual(owner.itemCounts, { 1: 0 });
    assert.deepEqual(removedPackets, [["Q", 10]]);
});
