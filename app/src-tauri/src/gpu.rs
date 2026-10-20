// GPU usage per graphics card, like Task Manager: for each GPU the busiest engine type
// (3D, video decode, ...) summed over processes. Windows: PDH "GPU Engine" counters + DXGI names.
// Mac: ioreg "Device Utilization %" of each IOAccelerator.
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct GpuUsage {
    pub id: String,   // stable key the key setting stores (Windows: adapter LUID)
    pub name: String,
    pub usage: f32,   // 0..100
}

#[cfg(windows)]
mod imp {
    use super::GpuUsage;
    use std::collections::HashMap;
    use std::sync::Mutex;
    use windows::core::w;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::System::Performance::*;

    struct Query {
        query: PDH_HQUERY,
        counter: PDH_HCOUNTER,
        names: HashMap<String, String>,
    }
    unsafe impl Send for Query {}

    static Q: Mutex<Option<Query>> = Mutex::new(None);

    fn luid_key(high: i32, low: u32) -> String {
        format!("luid_0x{:08X}_0x{:08X}", high as u32, low)
    }

    // LUID -> "NVIDIA GeForce RTX 5090", hardware adapters only
    fn adapter_names() -> HashMap<String, String> {
        let mut out = HashMap::new();
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
            let mut i = 0;
            while let Ok(a) = factory.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = a.GetDesc1() else { continue };
                if d.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                    continue;
                }
                let len = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
                let name = String::from_utf16_lossy(&d.Description[..len]);
                out.insert(luid_key(d.AdapterLuid.HighPart, d.AdapterLuid.LowPart), name);
            }
        }
        out
    }

    fn open() -> Option<Query> {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut counter = PDH_HCOUNTER::default();
            if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut counter) != 0 {
                PdhCloseQuery(query);
                return None;
            }
            PdhCollectQueryData(query); // rates need two samples; the first call returns nothing
            Some(Query { query, counter, names: adapter_names() })
        }
    }

    pub fn read() -> Vec<GpuUsage> {
        let mut guard = Q.lock().unwrap();
        if guard.is_none() {
            *guard = open();
        }
        let Some(q) = guard.as_ref() else { return vec![] };
        // per GPU, per engine type: sum over processes
        let mut sums: HashMap<String, HashMap<String, f64>> = HashMap::new();
        unsafe {
            if PdhCollectQueryData(q.query) != 0 {
                return vec![];
            }
            let mut size = 0u32;
            let mut count = 0u32;
            PdhGetFormattedCounterArrayW(q.counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
            if size == 0 {
                return vec![];
            }
            let mut buf = vec![0u8; size as usize];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(q.counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
                return vec![];
            }
            for i in 0..count as usize {
                let it = &*items.add(i);
                let name = it.szName.to_string().unwrap_or_default();
                // pid_1234_luid_0x00000000_0x0000D1A2_phys_0_eng_0_engtype_3D
                let Some(l) = name.find("luid_") else { continue };
                let luid: String = name[l..].chars().take(26).collect();
                let engtype = name.rsplit("engtype_").next().unwrap_or("").to_string();
                let v = it.FmtValue.Anonymous.doubleValue;
                *sums.entry(luid).or_default().entry(engtype).or_default() += v;
            }
        }
        let mut out: Vec<GpuUsage> = q
            .names
            .iter()
            .map(|(luid, name)| {
                let usage = sums.get(luid).map(|m| m.values().cloned().fold(0.0, f64::max)).unwrap_or(0.0);
                GpuUsage { id: luid.clone(), name: name.clone(), usage: usage.clamp(0.0, 100.0) as f32 }
            })
            .collect();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }
}

#[cfg(windows)]
pub fn read() -> Vec<GpuUsage> {
    imp::read()
}

#[cfg(not(windows))]
pub fn read() -> Vec<GpuUsage> {
    let Ok(out) = std::process::Command::new("ioreg").args(["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]).output() else {
        return vec![];
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut gpus = Vec::new();
    for (i, part) in text.split("\"Device Utilization %\"=").skip(1).enumerate() {
        let n: String = part.chars().take_while(|c| c.is_ascii_digit()).collect();
        gpus.push(GpuUsage { id: format!("gpu{i}"), name: format!("GPU {}", i + 1), usage: n.parse().unwrap_or(0.0) });
    }
    gpus
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_gpus() {
        super::read();
        std::thread::sleep(std::time::Duration::from_millis(1000));
        for g in super::read() {
            println!("GPU {} | {} | {:.1}%", g.id, g.name, g.usage);
        }
    }
}
