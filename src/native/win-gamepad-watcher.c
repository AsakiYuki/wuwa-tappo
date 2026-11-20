/*
 * Windows controller watcher: polls XInput and prints button changes on stdout using the same
 * line protocol as mac-gamepad-watcher (`GamepadN \t linux_button_code \t 0|1`).
 *
 * XInput is loaded at runtime (xinput1_4 → xinput1_3 → xinput9_1_0) so the binary builds with
 * MinGW or MSVC without import libraries and runs on every supported Windows version.
 * The process exits when stdout is closed or when the parent process given as argv[1] exits,
 * so it never outlives Wuwa Tappo even if the app crashes while no controller is connected.
 */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Subset of <xinput.h>, declared here so no SDK header is required. */
typedef struct {
    WORD wButtons;
    BYTE bLeftTrigger;
    BYTE bRightTrigger;
    SHORT sThumbLX;
    SHORT sThumbLY;
    SHORT sThumbRX;
    SHORT sThumbRY;
} PadState;

typedef struct {
    DWORD dwPacketNumber;
    PadState Gamepad;
} PadReading;

typedef DWORD(WINAPI* XInputGetStateFn)(DWORD, PadReading*);

#define MAX_PADS 4
#define POLL_MS 8
/* XInputGetState on an empty slot is slow, so empty slots are re-checked only once a second. */
#define RESCAN_MS 1000
#define TRIGGER_THRESHOLD 30

/* Linux evdev codes understood by gamepadButtonName() in input-keymaps.ts. */
static const struct {
    WORD mask;
    int code;
} BUTTONS[] = {
    { 0x1000, 304 }, /* A → South */
    { 0x2000, 305 }, /* B → East */
    { 0x4000, 308 }, /* X → West */
    { 0x8000, 307 }, /* Y → North */
    { 0x0100, 310 }, /* LB → L1 */
    { 0x0200, 311 }, /* RB → R1 */
    { 0x0020, 314 }, /* Back → Select */
    { 0x0010, 315 }, /* Start */
    { 0x0040, 317 }, /* Left stick → L3 */
    { 0x0080, 318 }, /* Right stick → R3 */
    { 0x0001, 544 }, /* D-pad up */
    { 0x0002, 545 }, /* D-pad down */
    { 0x0004, 546 }, /* D-pad left */
    { 0x0008, 547 }, /* D-pad right */
};
#define BTN_TL2 312
#define BTN_TR2 313

typedef struct {
    BOOL connected;
    WORD buttons;
    BOOL leftTrigger;
    BOOL rightTrigger;
    ULONGLONG nextCheck;
} Slot;

static Slot g_slots[MAX_PADS];

static void emit(int pad, int code, BOOL down) {
    if (printf("Gamepad%d\t%d\t%d\n", pad + 1, code, down ? 1 : 0) < 0 || fflush(stdout) != 0) ExitProcess(0);
}

static void emit_status(const char* status, int pad) {
    if (printf("STATUS:%s:Gamepad%d\n", status, pad + 1) < 0 || fflush(stdout) != 0) ExitProcess(0);
}

static void update_buttons(int pad, Slot* slot, WORD buttons, BOOL leftTrigger, BOOL rightTrigger) {
    for (size_t i = 0; i < sizeof(BUTTONS) / sizeof(BUTTONS[0]); i++) {
        BOOL was = (slot->buttons & BUTTONS[i].mask) != 0;
        BOOL now = (buttons & BUTTONS[i].mask) != 0;
        if (was != now) emit(pad, BUTTONS[i].code, now);
    }
    if (slot->leftTrigger != leftTrigger) emit(pad, BTN_TL2, leftTrigger);
    if (slot->rightTrigger != rightTrigger) emit(pad, BTN_TR2, rightTrigger);
    slot->buttons = buttons;
    slot->leftTrigger = leftTrigger;
    slot->rightTrigger = rightTrigger;
}

static XInputGetStateFn load_xinput(void) {
    const char* libraries[] = { "xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll" };
    for (size_t i = 0; i < sizeof(libraries) / sizeof(libraries[0]); i++) {
        HMODULE module = LoadLibraryA(libraries[i]);
        if (!module) continue;
        XInputGetStateFn getState = (XInputGetStateFn)(void*)GetProcAddress(module, "XInputGetState");
        if (getState) return getState;
        FreeLibrary(module);
    }
    return NULL;
}

int main(int argc, char** argv) {
    XInputGetStateFn getState = load_xinput();
    if (!getState) {
        fprintf(stderr, "XInput is not available\n");
        return 1;
    }
    HANDLE parent = argc > 1 ? OpenProcess(SYNCHRONIZE, FALSE, (DWORD)strtoul(argv[1], NULL, 10)) : NULL;

    printf("STATUS:READY\n");
    fflush(stdout);

    for (;;) {
        ULONGLONG now = GetTickCount64();
        for (int pad = 0; pad < MAX_PADS; pad++) {
            Slot* slot = &g_slots[pad];
            if (!slot->connected && now < slot->nextCheck) continue;

            PadReading reading;
            memset(&reading, 0, sizeof(reading));
            if (getState((DWORD)pad, &reading) != ERROR_SUCCESS) {
                if (slot->connected) {
                    /* Release everything that was held when the controller went away. */
                    update_buttons(pad, slot, 0, FALSE, FALSE);
                    slot->connected = FALSE;
                    emit_status("DISCONNECTED", pad);
                }
                slot->nextCheck = now + RESCAN_MS;
                continue;
            }
            if (!slot->connected) {
                slot->connected = TRUE;
                emit_status("CONNECTED", pad);
            }
            update_buttons(pad, slot, reading.Gamepad.wButtons, reading.Gamepad.bLeftTrigger > TRIGGER_THRESHOLD,
                           reading.Gamepad.bRightTrigger > TRIGGER_THRESHOLD);
        }
        if (parent && WaitForSingleObject(parent, 0) == WAIT_OBJECT_0) return 0;
        Sleep(POLL_MS);
    }
}
