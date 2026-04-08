"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";

const SAMPLE_URLS = [
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/QGaujV3UdOMQSA6lVAC0/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/3CsDdNHkXRbsZ8n6RD48/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/3nuuiVT4tL041EMmWRp0/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/5Ujo3ecg7r5EnzLzcR25/thumb.jpg",
  "https://source.roboflow.com/SIeSImkutAOurn9hpksv1KzC6xq1/F75AFrdDJW2Ssvw6lFtr/thumb.jpg"
];

export default function Home() {
  const [activeTab, setActiveTab] = useState<"single" | "bulk" | "folder">("single");
  const [image, setImage] = useState<string | null>(null);
  const [bulkUrls, setBulkUrls] = useState<string>("");
  const [folderFiles, setFolderFiles] = useState<File[]>([]);
  const [folderProgress, setFolderProgress] = useState<{ done: number; total: number } | null>(null);
  const [logs, setLogs] = useState<{msg: string, type: 'info' | 'success' | 'err'}[]>([]);
  const [isImporting, setIsImporting] = useState(false);

  const processMutation = api.marathon.processImage.useMutation();
  const urlMutation = api.marathon.processFromUrl.useMutation();

  const addLog = (msg: string, type: 'info' | 'success' | 'err' = 'info') => {
    setLogs(prev => [...prev, { msg, type }]);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  // Process Single Image
  const handleSingleScan = async () => {
    if (!image) return;
    addLog("Analyzing single image...", "info");
    const base64Data = image.split(",")[1]!;
    
    processMutation.mutate({ imageBase64: base64Data }, {
      onSuccess: (data) => addLog(`Success: Found ${data.runnersDetected} runners.`, "success"),
      onError: (err) => addLog(`Error: ${err.message}`, "err")
    });
  };

  // Process Bulk URLs
  const handleBulkImport = async () => {
    const urls = bulkUrls.split("\n").filter(u => u.trim().startsWith("http"));
    if (urls.length === 0) return;

    setIsImporting(true);
    setLogs([]);
    addLog(`Starting bulk import of ${urls.length} images...`, "info");

    for (const url of urls) {
      addLog(`Processing: ${url.slice(0, 40)}...`, "info");
      try {
        await urlMutation.mutateAsync({ url });
        addLog(`Successfully imported from URL.`, "success");
      } catch (err: any) {
        addLog(`Failed: ${err.message}`, "err");
      }
    }
    setIsImporting(false);
    addLog("Bulk import session finished.", "info");
  };

  const loadSamples = () => {
    setBulkUrls(SAMPLE_URLS.join("\n"));
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f =>
      f.type.startsWith("image/")
    );
    setFolderFiles(files);
    setFolderProgress(null);
    addLog(`Selected ${files.length} image(s) from folder.`, "info");
  };

  const handleFolderUpload = async () => {
    if (folderFiles.length === 0) return;
    setIsImporting(true);
    setLogs([]);
    setFolderProgress({ done: 0, total: folderFiles.length });
    addLog(`Starting folder upload: ${folderFiles.length} images...`, "info");

    for (let i = 0; i < folderFiles.length; i++) {
      const file = folderFiles[i]!;
      addLog(`Processing (${i + 1}/${folderFiles.length}): ${file.name}`, "info");
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(",")[1]!);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const result = await processMutation.mutateAsync({ imageBase64: base64, imageUrl: file.name });
        addLog(`Done: ${file.name} — ${result.runnersDetected} runner(s) found.`, "success");
      } catch (err: any) {
        addLog(`Failed: ${file.name} — ${err.message}`, "err");
      }
      setFolderProgress({ done: i + 1, total: folderFiles.length });
    }

    setIsImporting(false);
    addLog("Folder upload complete.", "info");
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#0a0a0a] text-white p-4 md:p-8 overflow-hidden relative">
      {/* Background Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-600/10 blur-[120px] rounded-full -z-10 animate-pulse"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[120px] rounded-full -z-10 animate-pulse" style={{animationDelay: '1s'}}></div>

      <div className="max-w-6xl w-full space-y-12 z-10">
        {/* Navigation */}
        <div className="flex justify-between items-center bg-zinc-900/50 backdrop-blur-md p-4 rounded-3xl border border-zinc-800">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center font-black text-xl shadow-lg shadow-purple-500/20">M</div>
             <h1 className="text-xl font-black tracking-tighter hidden sm:block">MARATHON<span className="text-zinc-500">AI</span></h1>
          </div>
          <div className="flex gap-2 bg-black/40 p-1 rounded-2xl border border-zinc-800">
             <button onClick={() => setActiveTab("single")} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === "single" ? "bg-zinc-800 text-white shadow-xl" : "text-zinc-500 hover:text-white"}`}>SCANNER</button>
             <button onClick={() => setActiveTab("bulk")} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === "bulk" ? "bg-zinc-800 text-white shadow-xl" : "text-zinc-500 hover:text-white"}`}>BULK IMPORT</button>
             <button onClick={() => setActiveTab("folder")} className={`px-5 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === "folder" ? "bg-zinc-800 text-white shadow-xl" : "text-zinc-500 hover:text-white"}`}>FOLDER</button>
          </div>
          <Link href="/library" className="px-6 py-2 bg-white text-black hover:bg-zinc-200 rounded-2xl text-xs font-black transition-all">
            LIBRARY →
          </Link>
        </div>

        {/* Hero Section */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
           <h2 className="text-5xl md:text-7xl font-black tracking-tight leading-none bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent">
             {activeTab === "single" ? "INDIVIDUAL SCAN" : activeTab === "bulk" ? "DATASET IMPORT" : "FOLDER UPLOAD"}
           </h2>
           <p className="text-zinc-500 font-medium text-lg">
             {activeTab === "single" ? "Identify bibs and faces from a single photograph." : activeTab === "bulk" ? "Connect a Roboflow dataset or a list of URLs to populate your library automatically." : "Select a local folder and process all images at once."}
           </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8 items-start">
          {/* Main Action Area */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-zinc-900/40 border border-zinc-800 p-8 rounded-[2.5rem] backdrop-blur-2xl shadow-3xl relative overflow-hidden group">
              {activeTab === "single" ? (
                <div className="space-y-6">
                  <label className="group relative flex flex-col items-center justify-center w-full h-[400px] border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:border-purple-500/50 hover:bg-purple-500/5 transition-all duration-500 overflow-hidden">
                    {image ? (
                      <img src={image} className="w-full h-full object-cover" alt="Preview" />
                    ) : (
                      <div className="text-center space-y-4">
                        <div className="w-16 h-16 bg-zinc-800 rounded-2xl mx-auto flex items-center justify-center group-hover:scale-110 transition-transform">
                          <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                        </div>
                        <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Drop Photo Here</p>
                      </div>
                    )}
                    <input type="file" className="hidden" accept="image/*" onChange={handleImageChange} />
                  </label>
                  <button onClick={handleSingleScan} disabled={!image || processMutation.isPending} className="w-full py-5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-2xl font-black text-lg transition-all shadow-xl shadow-purple-900/20 active:scale-[0.98]">
                    {processMutation.isPending ? "SCANNING..." : "START RECOGNITION"}
                  </button>
                </div>
              ) : activeTab === "bulk" ? (
                <div className="space-y-6">
                  <div className="flex justify-between items-end">
                     <div>
                        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">Dataset URLs</p>
                        <p className="text-sm text-zinc-400">Paste Roboflow image links (one per line)</p>
                     </div>
                     <button onClick={loadSamples} className="text-[10px] font-black text-purple-400 border border-purple-400/30 px-3 py-1 rounded-lg hover:bg-purple-400/10 transition-all uppercase">
                       Load Roboflow Sample
                     </button>
                  </div>
                  <textarea
                    value={bulkUrls}
                    onChange={(e) => setBulkUrls(e.target.value)}
                    placeholder="https://source.roboflow.com/..."
                    className="w-full h-[320px] bg-black/40 border border-zinc-800 rounded-3xl p-6 text-zinc-300 font-mono text-sm focus:outline-none focus:border-purple-500/50 transition-all resize-none shadow-inner"
                  />
                  <button onClick={handleBulkImport} disabled={isImporting || !bulkUrls} className="w-full py-5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl font-black text-lg transition-all shadow-xl shadow-blue-900/20 active:scale-[0.98]">
                    {isImporting ? "IMPORTING..." : "START BULK IMPORT"}
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <label className="group relative flex flex-col items-center justify-center w-full h-[320px] border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:border-green-500/50 hover:bg-green-500/5 transition-all duration-500">
                    <div className="text-center space-y-4">
                      <div className="w-16 h-16 bg-zinc-800 rounded-2xl mx-auto flex items-center justify-center group-hover:scale-110 transition-transform">
                        <svg className="w-8 h-8 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
                      </div>
                      {folderFiles.length > 0 ? (
                        <div>
                          <p className="text-white font-black text-lg">{folderFiles.length} images selected</p>
                          <p className="text-zinc-500 text-xs mt-1">Click to change folder</p>
                        </div>
                      ) : (
                        <p className="text-zinc-500 font-bold uppercase tracking-widest text-xs">Click to select a folder</p>
                      )}
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      {...({ webkitdirectory: "true", directory: "true" } as any)}
                      multiple
                      onChange={handleFolderChange}
                    />
                  </label>
                  {folderProgress && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-zinc-500 font-bold">
                        <span>Progress</span>
                        <span>{folderProgress.done} / {folderProgress.total}</span>
                      </div>
                      <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-green-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${(folderProgress.done / folderProgress.total) * 100}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <button onClick={handleFolderUpload} disabled={isImporting || folderFiles.length === 0} className="w-full py-5 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded-2xl font-black text-lg transition-all shadow-xl shadow-green-900/20 active:scale-[0.98]">
                    {isImporting ? "UPLOADING..." : `UPLOAD ${folderFiles.length > 0 ? folderFiles.length + " IMAGES" : "FOLDER"}`}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Activity Log / Feedback */}
          <div className="lg:col-span-2 space-y-6 flex flex-col h-full">
            <div className="bg-zinc-900/40 border border-zinc-800 p-8 rounded-[2.5rem] backdrop-blur-2xl flex-1 flex flex-col min-h-[500px]">
               <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500">Live Feedback</h3>
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
               </div>

               <div className="flex-1 overflow-auto bg-black/40 rounded-3xl p-4 border border-zinc-800/50 space-y-3 font-mono text-[11px] custom-scrollbar">
                  {logs.length > 0 ? logs.map((log, i) => (
                    <div key={i} className={`p-3 rounded-xl border ${
                      log.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                      log.type === 'err' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                      'bg-zinc-800/50 border-zinc-700/50 text-zinc-400'
                    }`}>
                      <span className="opacity-50 mr-2">[{new Date().toLocaleTimeString([], {hour12: false})}]</span>
                      {log.msg}
                    </div>
                  )) : (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-700 text-center space-y-4 opacity-50">
                       <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                       <p className="font-bold">Awaiting processing...</p>
                    </div>
                  )}
               </div>

               {isImporting && (
                 <div className="mt-6 pt-6 border-t border-zinc-800">
                    <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                       <div className="bg-blue-500 h-full animate-progress-fast"></div>
                    </div>
                 </div>
               )}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes progress {
          0% { width: 0% }
          100% { width: 100% }
        }
        .animate-progress-fast {
          animation: progress 2s ease-in-out infinite;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
      `}</style>
    </main>
  );
}
