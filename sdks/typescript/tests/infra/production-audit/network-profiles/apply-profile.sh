#!/bin/bash
set -e

PROFILE="${LIOP_NET_PROFILE:-lan}"
echo "[NET] Configuring network traffic control with profile: ${PROFILE} on eth0"

# Remove existing root qdisc if present
tc qdisc del dev eth0 root 2>/dev/null || true

case "${PROFILE}" in
  "cross-atlantic")
    echo "[NET] Applying Cross-Atlantic Profile: 85ms delay (+/- 15ms), 0.1% loss"
    tc qdisc add dev eth0 root netem delay 85ms 15ms distribution normal loss 0.1%
    ;;
  "cross-atlantic-london")
    echo "[NET] Applying London-Atlantic Profile: 75ms delay (+/- 10ms), 0.05% loss"
    tc qdisc add dev eth0 root netem delay 75ms 10ms distribution normal loss 0.05%
    ;;
  "cross-pacific")
    echo "[NET] Applying Cross-Pacific Profile: 150ms delay (+/- 30ms), 0.5% loss"
    tc qdisc add dev eth0 root netem delay 150ms 30ms distribution normal loss 0.5%
    ;;
  "hostile-3g")
    echo "[NET] Applying Hostile 3G Profile: 300ms delay (+/- 100ms), 3% loss, 5% reorder, 0.5% duplicate"
    tc qdisc add dev eth0 root netem delay 300ms 100ms distribution pareto loss 3% reorder 5% duplicate 0.5%
    ;;
  "moderate")
    echo "[NET] Applying Moderate Profile: 45ms delay (+/- 5ms)"
    tc qdisc add dev eth0 root netem delay 45ms 5ms distribution normal
    ;;
  "lan"|*)
    echo "[NET] Profile '${PROFILE}' active — native LAN mode (zero shaping)"
    ;;
esac

echo "[NET] Network configuration complete."
