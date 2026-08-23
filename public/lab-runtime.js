(() => {
    const FRAME_MS = 1000 / 60;

    const commentsStyle = document.createElement("link");
    commentsStyle.rel = "stylesheet";
    commentsStyle.href = "/lab-comments.css";
    document.head.appendChild(commentsStyle);

    const commentsScript = document.createElement("script");
    commentsScript.src = "/lab-comments.js";
    commentsScript.defer = true;
    document.head.appendChild(commentsScript);

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
