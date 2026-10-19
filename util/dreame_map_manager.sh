#!/bin/sh
set -e
ACTION="$1"
FLOOR="$2"
BACKUP_DIR="/data/maps_backup"
CURRENT_FILE="$BACKUP_DIR/current_floor.txt"

mkdir -p "$BACKUP_DIR"

play_sound() {
    if [ -f "/data/audio/EN/$1" ]; then
        ogg123 "/data/audio/EN/$1" >/dev/null 2>&1 &
    fi
}

restart_ava_safe() {
    touch /tmp/restart_ava.mark
    rm -rf /data/ava_reboot_cnt
    sync
    /etc/rc.d/ava.sh >/dev/null 2>&1 &
}

extract_archive() {
    ARC="$1"
    FIRST_ENTRY=$(tar -tzf "$ARC" | head -n 1)
    case "$FIRST_ENTRY" in
        data/*)
            tar -xzf "$ARC" -C /
            ;;
        *)
            tar -xzf "$ARC" -C /data
            ;;
    esac
}

save_floor() {
    TARGET="$1"
    if [ -z "$TARGET" ] || [ "$TARGET" = "nouvelle_carte_vierge" ]; then
        return 0
    fi
    TMP_TAR="$BACKUP_DIR/${TARGET}.tar.gz.tmp"
    FINAL_TAR="$BACKUP_DIR/${TARGET}.tar.gz"
    tar -czf "$TMP_TAR" -C /data ri map DivideMap config/ava/mult_map.json 2>/dev/null || true
    if [ -s "$TMP_TAR" ] && [ $(wc -c < "$TMP_TAR") -gt 2000 ] && tar -tzf "$TMP_TAR" >/dev/null 2>&1; then
        mv "$TMP_TAR" "$FINAL_TAR"
        sync
    else
        rm -f "$TMP_TAR"
        echo "Error: Failed to create valid archive for $TARGET" >&2
        return 1
    fi
}

case "$ACTION" in
    save)
        if [ -z "$FLOOR" ]; then
            FLOOR=$(cat "$CURRENT_FILE" 2>/dev/null || echo "etage_1")
        fi
        save_floor "$FLOOR"
        echo "$FLOOR" > "$CURRENT_FILE"
        play_sound "map_saved.ogg"
        echo "Saved map to $FLOOR"
        ;;
    load)
        if [ -z "$FLOOR" ]; then
            echo "Missing floor name" >&2
            exit 1
        fi
        CUR=$(cat "$CURRENT_FILE" 2>/dev/null || echo "")
        if [ -n "$CUR" ] && [ "$CUR" != "nouvelle_carte_vierge" ] && [ -f "/data/ri/1.dat2" ] && [ $(wc -c < "/data/ri/1.dat2") -gt 5000 ]; then
            save_floor "$CUR" || true
            save_floor "last_autosave" || true
        fi

        if [ "$FLOOR" = "nouvelle_carte_vierge" ]; then
            rm -rf /data/ri/* /data/map/* /data/DivideMap/* /data/config/ava/mult_map.json
            echo "nouvelle_carte_vierge" > "$CURRENT_FILE"
            restart_ava_safe
            sleep 2
            play_sound "map_blank.ogg"
            echo "Initialized blank map"
        else
            ARCHIVE="$BACKUP_DIR/${FLOOR}.tar.gz"
            if [ ! -f "$ARCHIVE" ]; then
                echo "Archive $ARCHIVE does not exist" >&2
                exit 1
            fi
            tar -tzf "$ARCHIVE" >/dev/null 2>&1
            rm -rf /data/ri/* /data/map/* /data/DivideMap/* /data/config/ava/mult_map.json
            extract_archive "$ARCHIVE"
            echo "$FLOOR" > "$CURRENT_FILE"
            restart_ava_safe
            sleep 2
            play_sound "map_loaded.ogg"
            echo "Loaded map $FLOOR"
        fi
        ;;
    status)
        cat "$CURRENT_FILE" 2>/dev/null || echo "etage_1"
        ;;
    *)
        echo "Usage: $0 {save|load|status} [floor_name]" >&2
        exit 1
        ;;
esac