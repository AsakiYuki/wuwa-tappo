#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hid/IOHIDManager.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define MAX_DEVICES 16

// Linux evdev button codes matching LINUX_GAMEPAD_BUTTONS in input-manager.ts
#define BTN_SOUTH     304
#define BTN_EAST      305
#define BTN_C         306
#define BTN_NORTH     307
#define BTN_WEST      308
#define BTN_TL        310 // L1
#define BTN_TR        311 // R1
#define BTN_TL2       312 // L2
#define BTN_TR2       313 // R2
#define BTN_SELECT    314
#define BTN_START     315
#define BTN_MODE      316
#define BTN_THUMBL    317 // L3
#define BTN_THUMBR    318 // R3

#define BTN_DPAD_UP    544
#define BTN_DPAD_DOWN  545
#define BTN_DPAD_LEFT  546
#define BTN_DPAD_RIGHT 547

typedef struct {
    IOHIDDeviceRef device;
    int index;
    char name[32];
    int lastHat;
    bool ltDown;
    bool rtDown;
} DeviceSlot;

static DeviceSlot g_devices[MAX_DEVICES];
static int g_nextGamepadNumber = 1;

static DeviceSlot* get_or_create_slot(IOHIDDeviceRef dev) {
    for (int i = 0; i < MAX_DEVICES; i++) {
        if (g_devices[i].device == dev) return &g_devices[i];
    }
    for (int i = 0; i < MAX_DEVICES; i++) {
        if (g_devices[i].device == NULL) {
            g_devices[i].device = dev;
            g_devices[i].index = g_nextGamepadNumber++;
            snprintf(g_devices[i].name, sizeof(g_devices[i].name), "Gamepad%d", g_devices[i].index);
            g_devices[i].lastHat = -1;
            g_devices[i].ltDown = false;
            g_devices[i].rtDown = false;
            return &g_devices[i];
        }
    }
    return NULL;
}

static void remove_slot(IOHIDDeviceRef dev) {
    for (int i = 0; i < MAX_DEVICES; i++) {
        if (g_devices[i].device == dev) {
            g_devices[i].device = NULL;
            g_devices[i].lastHat = -1;
            g_devices[i].ltDown = false;
            g_devices[i].rtDown = false;
            break;
        }
    }
}

static void emit_input(const char* deviceName, int code, int down) {
    if (!deviceName) return;
    // Format: deviceName \t linux_button_code \t down
    printf("%s\t%d\t%d\n", deviceName, code, down ? 1 : 0);
    fflush(stdout);
}

static int hid_usage_to_linux_code(uint32_t usage) {
    switch (usage) {
        case 1: return BTN_SOUTH;
        case 2: return BTN_EAST;
        case 3: return BTN_WEST;
        case 4: return BTN_NORTH;
        case 5: return BTN_TL;
        case 6: return BTN_TR;
        case 7: return BTN_TL2;
        case 8: return BTN_TR2;
        case 9: return BTN_SELECT;
        case 10: return BTN_START;
        case 11: return BTN_THUMBL;
        case 12: return BTN_THUMBR;
        case 13: return BTN_MODE;
        default:
            return (int)usage;
    }
}

static void handle_hatswitch(DeviceSlot* slot, CFIndex val, CFIndex minVal, CFIndex maxVal) {
    int prev = slot->lastHat;
    int curr = -1;

    // Normalizing hatswitch values (0..7 where 0=Up, 1=UpRight, 2=Right, 3=DownRight, 4=Down, 5=DownLeft, 6=Left, 7=UpLeft)
    if (val >= minVal && val <= maxVal) {
        CFIndex range = maxVal - minVal + 1;
        if (range == 8) {
            curr = (int)(val - minVal);
        } else if (range == 4) {
            // 4-way hat: 0=Up, 1=Right, 2=Down, 3=Left
            int m[4] = { 0, 2, 4, 6 };
            curr = m[val - minVal];
        }
    }

    if (curr == prev) return;

    // Release previous directions
    if (prev >= 0) {
        if (prev == 0 || prev == 1 || prev == 7) emit_input(slot->name, BTN_DPAD_UP, 0);
        if (prev == 1 || prev == 2 || prev == 3) emit_input(slot->name, BTN_DPAD_RIGHT, 0);
        if (prev == 3 || prev == 4 || prev == 5) emit_input(slot->name, BTN_DPAD_DOWN, 0);
        if (prev == 5 || prev == 6 || prev == 7) emit_input(slot->name, BTN_DPAD_LEFT, 0);
    }

    // Press new directions
    if (curr >= 0) {
        if (curr == 0 || curr == 1 || curr == 7) emit_input(slot->name, BTN_DPAD_UP, 1);
        if (curr == 1 || curr == 2 || curr == 3) emit_input(slot->name, BTN_DPAD_RIGHT, 1);
        if (curr == 3 || curr == 4 || curr == 5) emit_input(slot->name, BTN_DPAD_DOWN, 1);
        if (curr == 5 || curr == 6 || curr == 7) emit_input(slot->name, BTN_DPAD_LEFT, 1);
    }

    slot->lastHat = curr;
}

static void handle_trigger_axis(DeviceSlot* slot, bool isLeft, CFIndex val, CFIndex minVal, CFIndex maxVal) {
    if (maxVal <= minVal) return;
    double normalized = (double)(val - minVal) / (double)(maxVal - minVal);
    bool down = normalized > 0.35;
    bool* state = isLeft ? &slot->ltDown : &slot->rtDown;
    int code = isLeft ? BTN_TL2 : BTN_TR2;

    if (*state != down) {
        *state = down;
        emit_input(slot->name, code, down ? 1 : 0);
    }
}

static void on_input_value(void* context, IOReturn result, void* sender, IOHIDValueRef value) {
    (void)context;
    (void)result;
    IOHIDDeviceRef dev = (IOHIDDeviceRef)sender;
    DeviceSlot* slot = get_or_create_slot(dev);
    if (!slot) return;

    IOHIDElementRef elem = IOHIDValueGetElement(value);
    uint32_t page = IOHIDElementGetUsagePage(elem);
    uint32_t usage = IOHIDElementGetUsage(elem);
    CFIndex intVal = IOHIDValueGetIntegerValue(value);

    // 1. Digital Button Page (0x09) -> Map to Linux BTN_* codes
    if (page == kHIDPage_Button) {
        int code = hid_usage_to_linux_code(usage);
        emit_input(slot->name, code, intVal != 0);
        return;
    }

    // 2. Generic Desktop Page (0x01)
    if (page == kHIDPage_GenericDesktop) {
        CFIndex minVal = IOHIDElementGetLogicalMin(elem);
        CFIndex maxVal = IOHIDElementGetLogicalMax(elem);

        // Hatswitch / D-Pad (0x39) -> Map to BTN_DPAD_*
        if (usage == kHIDUsage_GD_Hatswitch) {
            handle_hatswitch(slot, intVal, minVal, maxVal);
            return;
        }

        // Z axis (Left Trigger) or Rz axis (Right Trigger) -> BTN_TL2 / BTN_TR2
        if (usage == kHIDUsage_GD_Z) {
            handle_trigger_axis(slot, true, intVal, minVal, maxVal);
            return;
        }
        if (usage == kHIDUsage_GD_Rz) {
            handle_trigger_axis(slot, false, intVal, minVal, maxVal);
            return;
        }
    }

    // 3. Simulation Controls Page (0x02) - Brake / Accelerator
    if (page == kHIDPage_Simulation) {
        CFIndex minVal = IOHIDElementGetLogicalMin(elem);
        CFIndex maxVal = IOHIDElementGetLogicalMax(elem);
        if (usage == 0x4D || usage == 0xC4) { // Brake -> LT (BTN_TL2)
            handle_trigger_axis(slot, true, intVal, minVal, maxVal);
            return;
        }
        if (usage == 0x4B || usage == 0xC5) { // Accelerator -> RT (BTN_TR2)
            handle_trigger_axis(slot, false, intVal, minVal, maxVal);
            return;
        }
    }
}

static void on_device_matched(void* context, IOReturn result, void* sender, IOHIDDeviceRef device) {
    (void)context;
    (void)result;
    (void)sender;
    DeviceSlot* slot = get_or_create_slot(device);
    if (slot) {
        printf("STATUS:CONNECTED:%s\n", slot->name);
        fflush(stdout);
    }
}

static void on_device_removed(void* context, IOReturn result, void* sender, IOHIDDeviceRef device) {
    (void)context;
    (void)result;
    (void)sender;
    remove_slot(device);
}

static void on_sigint(int sig) {
    (void)sig;
    CFRunLoopStop(CFRunLoopGetCurrent());
}

int main(void) {
    signal(SIGINT, on_sigint);
    signal(SIGTERM, on_sigint);

    IOHIDManagerRef manager = IOHIDManagerCreate(kCFAllocatorDefault, kIOHIDOptionsTypeNone);
    if (!manager) {
        fprintf(stderr, "Failed to create IOHIDManager\n");
        return 1;
    }

    CFMutableArrayRef matchingList = CFArrayCreateMutable(kCFAllocatorDefault, 0, &kCFTypeArrayCallBacks);
    const uint32_t usages[] = {
        kHIDUsage_GD_Joystick,
        kHIDUsage_GD_GamePad,
        kHIDUsage_GD_MultiAxisController,
    };
    for (size_t i = 0; i < sizeof(usages) / sizeof(usages[0]); i++) {
        CFMutableDictionaryRef dict = CFDictionaryCreateMutable(kCFAllocatorDefault, 0, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        int page = kHIDPage_GenericDesktop;
        int usage = usages[i];
        CFNumberRef pageNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &page);
        CFNumberRef usageNum = CFNumberCreate(kCFAllocatorDefault, kCFNumberIntType, &usage);
        CFDictionarySetValue(dict, CFSTR(kIOHIDDeviceUsagePageKey), pageNum);
        CFDictionarySetValue(dict, CFSTR(kIOHIDDeviceUsageKey), usageNum);
        CFArrayAppendValue(matchingList, dict);
        CFRelease(pageNum);
        CFRelease(usageNum);
        CFRelease(dict);
    }

    IOHIDManagerSetDeviceMatchingMultiple(manager, matchingList);
    CFRelease(matchingList);

    IOHIDManagerRegisterDeviceMatchingCallback(manager, on_device_matched, NULL);
    IOHIDManagerRegisterDeviceRemovalCallback(manager, on_device_removed, NULL);
    IOHIDManagerRegisterInputValueCallback(manager, on_input_value, NULL);

    IOHIDManagerScheduleWithRunLoop(manager, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode);
    IOReturn ret = IOHIDManagerOpen(manager, kIOHIDOptionsTypeNone);
    if (ret != kIOReturnSuccess) {
        fprintf(stderr, "IOHIDManagerOpen failed: 0x%08x\n", ret);
        CFRelease(manager);
        return 1;
    }

    printf("STATUS:READY\n");
    fflush(stdout);

    CFRunLoopRun();

    IOHIDManagerClose(manager, kIOHIDOptionsTypeNone);
    CFRelease(manager);
    return 0;
}
