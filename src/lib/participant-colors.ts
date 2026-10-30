// Stable per participant; names remain visible so color is never the only signal.
export function participantHue(identity: string) {
    let hash = 0;
    for (const char of identity.replace(/:\d+@/, '@')) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    return [210, 270, 330, 25, 155, 185, 55, 295, 115, 355, 235, 75][(hash >>> 0) % 12];
}
