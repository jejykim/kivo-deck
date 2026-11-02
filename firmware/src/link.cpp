#include <LittleFS.h>
#include <Update.h>
#include <esp_ota_ops.h>
#include <mbedtls/base64.h>
#include "config.h"
#include "deck.h"

// defined in main.cpp
void calibrateTouch();
void sendState();

// The app reads this from firmware.bin: it refuses files without it and shows the version.
// hello uses the same string, so the linker keeps it.
static const char fwTag[] = "KIVO_DECK_FW=" FW_VERSION;
static const char *const fwVersion = fwTag + sizeof("KIVO_DECK_FW=") - 1;

// The bootloader boots a new version once. It stays only after hello (below) proves USB works.
extern "C" bool verifyRollbackLater() { return true; }
static bool otaUnconfirmed = false;
static bool otaActive = false;
static uint32_t otaLastData = 0;

static const char *devId = "";
static char *rx = nullptr;          // one command line
static size_t rxLen = 0;
static bool rxOverflow = false;
static uint8_t *bin = nullptr;      // decoded base64 (file chunks, live tiles)
static const size_t BIN_MAX = RX_LINE_MAX * 3 / 4 + 4;

static File upFile;
static size_t upExpect = 0, upGot = 0;

namespace pc {

void send(const char *json) { Serial.println(json); }

static void ok() { send("{\"ev\":\"ok\"}"); }
static void error(const char *msg) {
  char b[160]; snprintf(b, sizeof b, "{\"ev\":\"error\",\"msg\":\"%s\"}", msg); send(b);
}

void event(const char *ev, int id, const char *field, int value) {
  char b[96]; snprintf(b, sizeof b, "{\"ev\":\"%s\",\"id\":%d,\"%s\":%d}", ev, id, field, value); send(b);
}

void act(const char *src, int id, int page, const char *kind, int n) {
  char b[128];
  snprintf(b, sizeof b, "{\"ev\":\"act\",\"src\":\"%s\",\"id\":%d,\"page\":%d,\"kind\":\"%s\",\"n\":%d}", src, id, page, kind, n);
  send(b);
}

static void hello() {
  char b[256];
  snprintf(b, sizeof b,
           "{\"ev\":\"hello\",\"fw\":\"%s\",\"device\":\"%s\",\"keys\":%d,\"knobs\":2,\"faders\":2,\"bundle\":\"%s\",\"page\":%d,\"ota\":1}",
           fwVersion, devId, KEY_COUNT, deck::bundleHash().c_str(), deck::page());
  send(b);
  if (otaUnconfirmed) { esp_ota_mark_app_valid_cancel_rollback(); otaUnconfirmed = false; }
}

// Restarting drops the half-written copy and brings back the screen, whatever was on it
static void otaFail(const char *msg) {
  error(msg);
  Serial.flush();
  delay(100);
  ESP.restart();
}

static int decode(const char *b64, size_t &out) {
  return mbedtls_base64_decode(bin, BIN_MAX, &out, (const unsigned char *)b64, strlen(b64));
}

static void removeBundleFiles() {
  File dir = LittleFS.open("/b");
  if (!dir) { LittleFS.mkdir("/b"); return; }
  std::vector<String> names;
  for (File f = dir.openNextFile(); f; f = dir.openNextFile()) names.push_back(String("/b/") + f.name());
  dir.close();
  for (auto &n : names) LittleFS.remove(n);
}

static bool safePath(const char *p) { return p && strncmp(p, "/b/", 3) == 0 && !strstr(p, "..") && strlen(p) < 64; }

static void handle(JsonDocument &d) {
  const char *cmd = d["cmd"] | "";
  if (!strcmp(cmd, "hello")) hello();
  else if (!strcmp(cmd, "ping")) send("{\"ev\":\"pong\"}");
  else if (!strcmp(cmd, "state")) sendState();
  else if (!strcmp(cmd, "calibrate")) calibrateTouch();
  else if (!strcmp(cmd, "page")) deck::gotoPage(d["n"] | 0, true);
  else if (!strcmp(cmd, "tile")) {
    size_t n = 0;
    if (decode(d["d"] | "", n) == 0) deck::drawTile(d["page"] | -1, d["key"] | -1, bin, n);
  }
  // ---- bundle upload: begin -> (open, data..., close)* -> end
  else if (!strcmp(cmd, "bundle.begin")) {
    deck::stopAnimations();
    if (upFile) upFile.close();
    removeBundleFiles();
    size_t need = d["size"] | 0;
    size_t free = LittleFS.totalBytes() - LittleFS.usedBytes();
    if (need + 8192 > free) { error("not enough space"); return; }
    ok();
  } else if (!strcmp(cmd, "file.open")) {
    const char *p = d["path"];
    if (!safePath(p)) { error("bad path"); return; }
    if (upFile) upFile.close();
    upFile = LittleFS.open(p, "w");
    if (!upFile) { error("open failed"); return; }
    upExpect = d["size"] | 0; upGot = 0;
    ok();
  } else if (!strcmp(cmd, "file.data")) {
    size_t n = 0;
    if (!upFile) { error("no open file"); return; }
    if (decode(d["d"] | "", n) != 0) { error("bad base64"); return; }
    if (upFile.write(bin, n) != n) { error("write failed (full?)"); return; }
    upGot += n;
    ok();
  } else if (!strcmp(cmd, "file.close")) {
    if (upFile) upFile.close();
    if (upGot != upExpect) { error("size mismatch"); return; }
    ok();
  } else if (!strcmp(cmd, "bundle.end")) {
    File h = LittleFS.open("/b/hash.txt", "w");
    if (h) { h.print(d["hash"] | ""); h.close(); }
    if (!deck::reload()) { error("bad config"); deck::drawPage(); return; }
    deck::drawPage();
    ok();
  }
  // ---- firmware update: begin -> data... -> end
  else if (!strcmp(cmd, "ota.begin")) {
    if (otaActive) { otaFail("update already running"); return; }
    if (!Update.begin(d["size"] | 0, U_FLASH)) { error(Update.errorString()); return; }
    otaActive = true;
    otaLastData = millis();
    deck::wakeIfSleeping();
    deck::setNotice("Updating firmware. Do not unplug.");
    deck::drawPage();
    ok();
  } else if (!strcmp(cmd, "ota.data")) {
    size_t n = 0;
    if (!otaActive) { error("no update running"); return; }
    if (decode(d["d"] | "", n) != 0) { otaFail("bad base64"); return; }
    if (Update.write(bin, n) != n) { otaFail(Update.errorString()); return; }
    otaLastData = millis();
    ok();
  } else if (!strcmp(cmd, "ota.end")) {
    if (!otaActive) { error("no update running"); return; }
    if (!Update.end()) { otaFail(Update.errorString()); return; }
    ok();
    Serial.flush();
    delay(100);
    ESP.restart();
  } else {
    error("unknown command");
  }
}

bool updating() { return otaActive; }

void begin(const char *deviceId) {
  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t st;
  otaUnconfirmed = esp_ota_get_state_partition(running, &st) == ESP_OK && st == ESP_OTA_IMG_PENDING_VERIFY;
  devId = deviceId;
  rx = (char *)heap_caps_malloc(RX_LINE_MAX + 1, MALLOC_CAP_SPIRAM);
  bin = (uint8_t *)heap_caps_malloc(BIN_MAX, MALLOC_CAP_SPIRAM);
}

void poll() {
  static JsonDocument doc;
  if (otaActive && millis() - otaLastData > OTA_DATA_TIMEOUT_MS) ESP.restart();
  if (otaUnconfirmed && millis() > OTA_CONFIRM_TIMEOUT_MS) esp_ota_mark_app_invalid_rollback_and_reboot();
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c != '\n') {
      if (rxLen < RX_LINE_MAX) rx[rxLen++] = c;
      else rxOverflow = true;
      continue;
    }
    rx[rxLen] = 0;
    if (rxOverflow) error("line too long");
    else if (rxLen) {
      doc.clear();
      if (deserializeJson(doc, rx, rxLen)) error("bad json");
      else handle(doc);
    }
    rxLen = 0; rxOverflow = false;
  }
}

}  // namespace pc
