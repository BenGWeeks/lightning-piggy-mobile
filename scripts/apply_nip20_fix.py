"""Apply NIP-20 OK response fix to Nostrclient router.py"""

with open("/app/lnbits/extensions/nostrclient/router.py", "r") as f:
    content = f.read()

old = """        if json_data[0] == "EVENT":
            nostr_client.relay_manager.publish_message(json_str)
            return"""

new = """        if json_data[0] == "EVENT":
            event_id = json_data[1].get("id", "") if len(json_data) > 1 else ""
            if not nostr_client.relay_manager.relays:
                # NIP-01: OK with failure when no relays are connected
                await self.websocket.send_text(
                    json.dumps(["OK", event_id, False, "error: no relay connections"])
                )
            else:
                nostr_client.relay_manager.publish_message(json_str)
                # NIP-01: OK response so clients know the event was accepted
                await self.websocket.send_text(
                    json.dumps(["OK", event_id, True, ""])
                )
            return"""

if old in content:
    content = content.replace(old, new)
    with open("/app/lnbits/extensions/nostrclient/router.py", "w") as f:
        f.write(content)
    print("NIP-20 OK fix applied successfully")
else:
    if 'json.dumps(["OK"' in content:
        print("Fix already applied")
    else:
        print("ERROR: Could not find the target code to patch")
