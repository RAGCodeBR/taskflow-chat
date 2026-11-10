import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    closeInDock, dockCapacity, fitDock, focusInDock, minimizeInDock, minimizedEntries, openInDock,
    parseDock, serializeDock, toggleExpandInDock, visibleEntries, DOCK_MAX_ENTRIES, type DockEntry,
} from "../chat-dock";

const jids = (list: DockEntry[]) => list.map(entry => entry.jid);

describe("dockCapacity", () => {
    it("shows one window on phones and as many as fit on wide screens", () => {
        assert.equal(dockCapacity(390), 1);
        assert.equal(dockCapacity(900), 2);
        assert.equal(dockCapacity(1350), 3);
        assert.equal(dockCapacity(1350, true), 2);
    });
});

describe("openInDock", () => {
    it("opens conversations side by side until they no longer fit", () => {
        let list: DockEntry[] = [];
        list = openInDock(list, { jid: "a@s", name: "Ana" }, 2, 1);
        list = openInDock(list, { jid: "b@s", name: "Bia" }, 2, 2);
        assert.deepEqual(jids(visibleEntries(list)), ["a@s", "b@s"]);
        list = openInDock(list, { jid: "c@s" }, 2, 3);
        assert.deepEqual(jids(visibleEntries(list)), ["b@s", "c@s"]);
        assert.deepEqual(jids(minimizedEntries(list)), ["a@s"]);
    });

    it("restores an already open conversation instead of duplicating it", () => {
        let list = openInDock([], { jid: "a@s" }, 1, 1);
        list = openInDock(list, { jid: "b@s" }, 1, 2);
        list = openInDock(list, { jid: "a@s", focusKeyId: "k1" }, 1, 3);
        assert.equal(list.length, 2);
        assert.deepEqual(jids(visibleEntries(list)), ["a@s"]);
        assert.equal(list.find(e => e.jid === "a@s")?.focusKeyId, "k1");
    });

    it("minimizes the least recently focused window first", () => {
        let list = openInDock([], { jid: "a@s" }, 2, 1);
        list = openInDock(list, { jid: "b@s" }, 2, 2);
        list = focusInDock(list, "a@s", 3);
        list = openInDock(list, { jid: "c@s" }, 2, 4);
        assert.deepEqual(jids(minimizedEntries(list)), ["b@s"]);
    });

    it("keeps the tray bounded by dropping the oldest minimized conversations", () => {
        let list: DockEntry[] = [];
        for (let i = 0; i < DOCK_MAX_ENTRIES + 3; i++) list = openInDock(list, { jid: `${i}@s` }, 1, i);
        assert.equal(list.length, DOCK_MAX_ENTRIES);
        assert.ok(!list.some(e => e.jid === "0@s"));
        assert.deepEqual(jids(visibleEntries(list)), [`${DOCK_MAX_ENTRIES + 2}@s`]);
    });
});

describe("window controls", () => {
    it("an expanded window takes two slots and only one is expanded", () => {
        let list = openInDock([], { jid: "a@s" }, 3, 1);
        list = openInDock(list, { jid: "b@s" }, 3, 2);
        list = openInDock(list, { jid: "c@s" }, 3, 3);
        list = toggleExpandInDock(list, "c@s", 3, 4);
        assert.deepEqual(jids(visibleEntries(list)), ["b@s", "c@s"]);
        list = toggleExpandInDock(list, "b@s", 3, 5);
        assert.deepEqual(list.filter(e => e.expanded).map(e => e.jid), ["b@s"]);
    });

    it("never expands on a single-slot screen", () => {
        const list = toggleExpandInDock(openInDock([], { jid: "a@s" }, 1, 1), "a@s", 1, 2);
        assert.equal(list[0].expanded, false);
        assert.equal(list[0].minimized, false);
    });

    it("minimizes and closes", () => {
        let list = openInDock([], { jid: "a@s" }, 2, 1);
        list = minimizeInDock(list, "a@s");
        assert.equal(visibleEntries(list).length, 0);
        assert.deepEqual(closeInDock(list, "a@s"), []);
    });

    it("refits when the screen shrinks", () => {
        let list = openInDock([], { jid: "a@s" }, 3, 1);
        list = openInDock(list, { jid: "b@s" }, 3, 2);
        list = fitDock(list, 1);
        assert.deepEqual(jids(visibleEntries(list)), ["b@s"]);
    });
});

describe("persistence", () => {
    it("round-trips without the transient focus target", () => {
        const list = openInDock([], { jid: "a@s", name: "Ana", focusKeyId: "k" }, 1, 5);
        assert.deepEqual(parseDock(serializeDock(list)), [{ jid: "a@s", name: "Ana", minimized: false, expanded: false, touched: 5 }]);
    });

    it("ignores damaged or unexpected data", () => {
        assert.deepEqual(parseDock("{"), []);
        assert.deepEqual(parseDock('{"a":1}'), []);
        assert.deepEqual(parseDock('[{"jid":5},{"jid":"nojid"},{"jid":"a@s"},{"jid":"a@s"}]').map(e => e.jid), ["a@s"]);
    });
});
