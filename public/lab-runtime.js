(() => {
    const FRAME_MS = 1000 / 60;

    window.PhysicsLab = Object.freeze({
        /**
         * Return elapsed time in 60 Hz frame units. Capping prevents a large
         * physics jump after the tab has been backgrounded or the device stalls.
         */
        frameScale(timestamp, previousTimestamp, maxFrames = 3) {
            if (!Number.isFinite(timestamp) || !Number.isFinite(previousTimestamp) || previousTimestamp <= 0) {
                return 1;
            }

            const elapsed = Math.max(0, timestamp - previousTimestamp);
            return Math.min(elapsed / FRAME_MS, maxFrames);
        },
    });
})();
