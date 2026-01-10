#!/bin/bash

# Post-Replay Script
# This script runs 10 seconds after replay completes, before the page reloads

echo '---------------------------------------------'
echo "Post-replay script started"
echo "Current time: $(date)"

networksetup -setnetworkserviceenabled "Wi-Fi" $(networksetup -getnetworkserviceenabled "Wi-Fi" | grep -q "Enable" && echo "Off" || echo "On")
sleep 2
networksetup -setnetworkserviceenabled "Wi-Fi" $(networksetup -getnetworkserviceenabled "Wi-Fi" | grep -q "Enable" && echo "Off" || echo "On")
sleep 6

echo '---------------------------------------------'
