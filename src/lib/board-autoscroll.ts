// While dragging on the Kanban, scrolls the board when the pointer nears an edge.
// Returns pixels per frame: negative toward the start, positive toward the end, faster closer to the edge.
export function edgeScrollSpeed(pointer: number, start: number, end: number, zone = 96, max = 28): number {
    const size = Math.min(zone, (end - start) / 3);
    if (size <= 0) return 0;
    if (pointer < start + size) return -Math.ceil(max * Math.min(1, (start + size - pointer) / size));
    if (pointer > end - size) return Math.ceil(max * Math.min(1, (pointer - (end - size)) / size));
    return 0;
}
