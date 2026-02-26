// Logic-on-Origin: Push Notifications (Watchdog)
// This module demonstrates streaming push events.
// It loops 3 times, pushing an event string via the host syscall, 
// then exits smoothly.

#[link(wasm_import_module = "nmp")]
extern "C" {
    fn push_event(ptr: *const u8, len: usize);
}

fn emit_event(msg: &str) {
    unsafe {
        push_event(msg.as_ptr(), msg.len());
    }
}

fn main() {
    println!("NMP Watchdog: Initializing. Will monitor system for 3 seconds...");
    
    for i in 1..=3 {
        // We use std::thread::sleep which translates to a WASI poll_oneoff call
        std::thread::sleep(std::time::Duration::from_secs(1));
        
        let msg = format!("High GPU Usage Detected (Spike #{})! Throttling necessary.", i);
        emit_event(&msg);
    }
    
    println!("NMP Watchdog: Finished monitoring.");
}
