"""
Builds real, Sideloadly / AltStore-ready unsigned .ipa packages for 3MK F X G:
  1. 3MK-F-X-G-iPhone.ipa (embeds 2-iPhone-Copy/www into Capacitor iOS ARM64 bundle)
  2. 3MK-F-X-G-iPad.ipa   (embeds 3-iPad-Copy/www into Capacitor iPadOS ARM64 bundle)

Preserves POSIX executable permissions (0755) on all Mach-O binaries and frameworks,
embeds the custom 3MK F X G PNG AppIcons, configures Info.plist, and includes CapacitorLocalNotifications.
"""

import os
import json
import shutil
import tempfile
import zipfile
import plistlib

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ICONS_DIR = os.path.join(ROOT_DIR, 'shared', 'icons')


def resolve_base_ipa():
    candidate_local = os.path.join(ROOT_DIR, '3MK-F-X-G-iPhone.ipa')
    if os.path.exists(candidate_local):
        return candidate_local
    candidate_parent = os.path.abspath(os.path.join(ROOT_DIR, '..', '3MK-F-X-G-iPhone.ipa'))
    if os.path.exists(candidate_parent):
        return candidate_parent
    raise FileNotFoundError('Base .ipa template not found.')


def load_icon_bytes(size):
    icon_path = os.path.join(ICONS_DIR, f'icon-{size}.png')
    if not os.path.exists(icon_path):
        raise FileNotFoundError(f'Missing generated app icon: {icon_path}')
    with open(icon_path, 'rb') as f:
        return f.read()


def add_bytes_to_zip(zf, arcname, data, is_executable=False, is_dir=False):
    info = zipfile.ZipInfo(arcname)
    info.compress_type = zipfile.ZIP_STORED if is_dir else zipfile.ZIP_DEFLATED
    info.create_system = 3  # UNIX
    if is_dir:
        info.external_attr = (0o040755 << 16) | 0x10
    elif is_executable:
        info.external_attr = 0o100755 << 16
    else:
        info.external_attr = 0o100644 << 16
    zf.writestr(info, data)


def build_ipa(base_ipa_bytes, edition_folder, ipa_filename, display_name, bundle_id, device_family):
    src_www = os.path.join(ROOT_DIR, edition_folder, 'www')
    if not os.path.isdir(src_www):
        raise FileNotFoundError(f'Missing web directory: {src_www}')

    out_root_ipa = os.path.join(ROOT_DIR, ipa_filename)
    out_edition_ipa = os.path.join(ROOT_DIR, edition_folder, ipa_filename)

    icon_60 = load_icon_bytes(60)
    icon_76 = load_icon_bytes(76)
    icon_120 = load_icon_bytes(120)
    icon_152 = load_icon_bytes(152)
    icon_167 = load_icon_bytes(167)
    icon_180 = load_icon_bytes(180)

    with tempfile.NamedTemporaryFile(delete=False, suffix='.ipa') as tmp_base:
        tmp_base.write(base_ipa_bytes)
        tmp_base_path = tmp_base.name

    try:
        with zipfile.ZipFile(tmp_base_path, 'r') as base_zip, zipfile.ZipFile(out_root_ipa, 'w', compression=zipfile.ZIP_DEFLATED) as out_zip:
            for item in base_zip.infolist():
                name = item.filename

                if name.startswith('Payload/App.app/public/'):
                    continue
                if '_CodeSignature' in name:
                    continue
                if name == 'Payload/App.app/Assets.car':
                    continue
                if name in (
                    'Payload/App.app/AppIcon60x60@1x.png',
                    'Payload/App.app/AppIcon60x60@2x.png',
                    'Payload/App.app/AppIcon60x60@3x.png',
                    'Payload/App.app/AppIcon76x76@1x~ipad.png',
                    'Payload/App.app/AppIcon76x76@2x~ipad.png',
                    'Payload/App.app/AppIcon83.5x83.5@2x~ipad.png',
                    'Payload/App.app/Icon.png',
                    'Payload/App.app/Icon@2x.png',
                    'Payload/App.app/Icon@3x.png',
                ):
                    continue

                if name == 'Payload/App.app/Info.plist':
                    plist = plistlib.loads(base_zip.read(name))
                    plist['CFBundleDisplayName'] = display_name
                    plist['CFBundleName'] = display_name
                    plist['CFBundleIdentifier'] = bundle_id
                    plist['CFBundleShortVersionString'] = '2.0.0'
                    plist['CFBundleVersion'] = '2'
                    plist['CFBundleDevelopmentRegion'] = 'en'
                    plist['UIDeviceFamily'] = device_family
                    plist['NSAppTransportSecurity'] = {
                        'NSAllowsArbitraryLoads': True,
                        'NSAllowsLocalNetworking': True
                    }
                    plist['NSLocalNetworkUsageDescription'] = (
                        '3MK F X G connects to your Desktop Shared Database over local Wi-Fi to sync your balances, income, and payments.'
                    )
                    plist['NSUserNotificationsUsageDescription'] = (
                        '3MK F X G sends you a 1-hour check-in notification after each payment asking: "Was it worth it?"'
                    )
                    plist['CFBundleIconFiles'] = [
                        'AppIcon60x60@2x.png',
                        'AppIcon60x60@3x.png',
                        'AppIcon76x76@2x~ipad.png',
                        'AppIcon83.5x83.5@2x~ipad.png'
                    ]
                    plist['CFBundleIcons'] = {
                        'CFBundlePrimaryIcon': {
                            'CFBundleIconFiles': ['AppIcon60x60'],
                            'CFBundleIconName': 'AppIcon',
                            'UIPrerenderedIcon': True
                        }
                    }
                    plist['CFBundleIcons~ipad'] = {
                        'CFBundlePrimaryIcon': {
                            'CFBundleIconFiles': ['AppIcon83.5x83.5', 'AppIcon76x76', 'AppIcon60x60'],
                            'CFBundleIconName': 'AppIcon',
                            'UIPrerenderedIcon': True
                        }
                    }
                    new_plist_bytes = plistlib.dumps(plist, fmt=plistlib.FMT_BINARY)
                    add_bytes_to_zip(out_zip, name, new_plist_bytes, is_executable=False)
                    continue

                if name == 'Payload/App.app/capacitor.config.json':
                    cap_cfg = {
                        "appId": bundle_id,
                        "appName": display_name,
                        "webDir": "public",
                        "loggingBehavior": "none",
                        "server": {
                            "cleartext": True,
                            "allowNavigation": ["*"]
                        },
                        "plugins": {
                            "Keyboard": {
                                "resize": "native",
                                "scrollPadding": True
                            },
                            "LocalNotifications": {
                                "smallIcon": "ic_stat_icon_config_sample",
                                "iconColor": "#6366f1",
                                "sound": "default"
                            }
                        },
                        "packageClassList": [
                            "AppPlugin",
                            "KeyboardPlugin",
                            "LocalNotificationsPlugin",
                            "StatusBarPlugin",
                            "NavigationBarPlugin",
                            "SafeAreaPlugin"
                        ]
                    }
                    add_bytes_to_zip(
                        out_zip,
                        name,
                        json.dumps(cap_cfg, indent=2).encode('utf-8'),
                        is_executable=False
                    )
                    continue

                data = base_zip.read(name)
                new_info = zipfile.ZipInfo(name)
                new_info.date_time = item.date_time
                new_info.compress_type = item.compress_type
                new_info.external_attr = item.external_attr
                new_info.create_system = 3
                out_zip.writestr(new_info, data)

            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon60x60@1x.png', icon_60)
            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon60x60@2x.png', icon_120)
            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon60x60@3x.png', icon_180)
            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon76x76@1x~ipad.png', icon_76)
            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon76x76@2x~ipad.png', icon_152)
            add_bytes_to_zip(out_zip, 'Payload/App.app/AppIcon83.5x83.5@2x~ipad.png', icon_167)
            add_bytes_to_zip(out_zip, 'Payload/App.app/Icon.png', icon_60)
            add_bytes_to_zip(out_zip, 'Payload/App.app/Icon@2x.png', icon_120)
            add_bytes_to_zip(out_zip, 'Payload/App.app/Icon@3x.png', icon_180)

            add_bytes_to_zip(out_zip, 'Payload/App.app/public/', b'', is_dir=True)
            for root, dirs, files in os.walk(src_www):
                rel_root = os.path.relpath(root, src_www).replace('\\', '/')
                if rel_root != '.':
                    add_bytes_to_zip(out_zip, f'Payload/App.app/public/{rel_root}/', b'', is_dir=True)
                for fname in files:
                    full_path = os.path.join(root, fname)
                    rel_path = os.path.relpath(full_path, src_www).replace('\\', '/')
                    arc_path = f'Payload/App.app/public/{rel_path}'
                    with open(full_path, 'rb') as f:
                        add_bytes_to_zip(out_zip, arc_path, f.read(), is_executable=False)
    finally:
        if os.path.exists(tmp_base_path):
            os.remove(tmp_base_path)

    shutil.copy2(out_root_ipa, out_edition_ipa)
    size_mb = os.path.getsize(out_root_ipa) / (1024 * 1024)
    print(f'Built {ipa_filename} ({size_mb:.2f} MB) -> {out_root_ipa} & {out_edition_ipa}')


def main():
    base_path = resolve_base_ipa()
    with open(base_path, 'rb') as f:
        base_ipa_bytes = f.read()

    build_ipa(
        base_ipa_bytes=base_ipa_bytes,
        edition_folder='2-iPhone-Copy',
        ipa_filename='3MK-F-X-G-iPhone.ipa',
        display_name='3MK F X G',
        bundle_id='com.3mkfxg.app.iphone',
        device_family=[1, 2]
    )
    build_ipa(
        base_ipa_bytes=base_ipa_bytes,
        edition_folder='3-iPad-Copy',
        ipa_filename='3MK-F-X-G-iPad.ipa',
        display_name='3MK F X G',
        bundle_id='com.3mkfxg.app.ipad',
        device_family=[2, 1]
    )


if __name__ == '__main__':
    main()
