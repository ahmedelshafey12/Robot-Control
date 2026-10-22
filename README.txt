RoboControl Final 8
===================

FILES
- index.html: dashboard structure
- style.css: visual design
- script.js: connection and control logic
- assets/robot-bg.jpg: robot background image (KEEP this folder and image)

UPLOAD
1. Extract this ZIP on your computer.
2. In InfinityFree File Manager open htdocs.
3. Upload index.html, style.css, script.js and the complete assets folder directly into htdocs. Do NOT upload the parent RoboControl_Final_8 folder itself.
4. Keep all three files in the same htdocs folder; keep robot-bg.jpg inside htdocs/assets/.
5. Replace old files, then open https://robot.gt.tc and press Ctrl+Shift+R.

IMPORTANT REAL-HARDWARE REQUIREMENTS
- Simulation is OFF by default. The page will not pretend the robot is connected.
- BLE uses service UUID 7b3e0001-6a4d-4f2a-9c1e-1234567890ab and write characteristic UUID 7b3e0002-6a4d-4f2a-9c1e-1234567890ab. ESP32 firmware must implement these exact UUIDs and understand commands such as STOP, MOVE forward low, LIGHT on, etc. If the current firmware uses Bluetooth Classic Serial, it must be changed to BLE GATT.
- Wi-Fi expects HTTP endpoints /ping, /status, /move?dir=forward&speed=low, /stop, /light?state=on, /horn, /calibrate and /reset. The ESP32 firmware must implement these endpoints and return CORS headers. HTTPS website to HTTP ESP32 may be blocked by browser mixed-content rules; test locally or serve the control page from the ESP32 AP/local origin if needed.
- The actual camera stream needs a compatible camera URL configured in Settings; the decorative preview is not a live camera.
- This package cannot guarantee motor/sensor operation until the ESP32 sketch and wiring match the protocol. Test with wheels lifted and use the STOP button.
