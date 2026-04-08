"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";

export default function Library() {
  const { data: runners, isLoading } = api.marathon.getAllRunners.useQuery();
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white p-4 md:p-12 relative overflow-hidden">
      {/* Lightbox Modal */}
      {selectedImage && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-20 cursor-zoom-out animate-in fade-in duration-300"
          onClick={() => setSelectedImage(null)}
        >
          <div className="absolute top-8 right-8 flex gap-4">
             <button className="w-12 h-12 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center transition-all">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
             </button>
          </div>
          <img 
            src={selectedImage} 
            className="max-w-full max-h-full object-contain rounded-2xl shadow-[0_0_100px_rgba(0,0,0,1)] border border-white/10 animate-in zoom-in-95 duration-300" 
            alt="Full size preview" 
          />
        </div>
      )}

      {/* Background Decor */}
      <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-purple-600/10 blur-[150px] rounded-full -z-10"></div>
      <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[150px] rounded-full -z-10"></div>

      <div className="max-w-7xl mx-auto space-y-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-2">
            <Link href="/" className="text-zinc-500 hover:text-white transition-colors text-sm font-bold flex items-center gap-2">
              ← BACK TO SCANNER
            </Link>
            <h1 className="text-5xl font-black tracking-tighter">RUNNER <span className="bg-gradient-to-r from-purple-400 to-blue-500 bg-clip-text text-transparent">LIBRARY</span></h1>
            <p className="text-zinc-500 font-medium text-lg">Browse identified athletes and their race history.</p>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 px-6 py-3 rounded-2xl backdrop-blur-md">
            <span className="text-zinc-500 text-xs font-black uppercase tracking-widest mr-3">TOTAL RUNNERS</span>
            <span className="text-2xl font-black">{runners?.length || 0}</span>
          </div>
        </div>

        {/* Runner Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {runners?.map((runner) => (
            <div key={runner.id} className="group bg-zinc-900/40 border border-zinc-800 rounded-[2.5rem] overflow-hidden backdrop-blur-2xl hover:border-purple-500/30 transition-all duration-500 shadow-2xl">
              {/* Profile Header */}
              <div className="p-8 pb-0 flex justify-between items-start">
                <div className="space-y-1">
                  <h3 className="text-3xl font-black tracking-tighter">
                    {runner.bibNumber ? `BIB #${runner.bibNumber}` : "UNNAMED"}
                  </h3>
                  <div className="flex items-center gap-2">
                     <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                     <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                       {runner.detections.length} SIGHTINGS
                     </span>
                  </div>
                </div>
                <div className="w-12 h-12 bg-zinc-800/80 rounded-2xl flex items-center justify-center border border-zinc-700/50 group-hover:bg-purple-600 group-hover:border-purple-500 transition-all duration-300">
                   <svg className="w-6 h-6 text-zinc-500 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                </div>
              </div>

              {/* Photo Gallery Preview */}
              <div className="p-8">
                <div className="grid grid-cols-2 gap-3 mb-6">
                  {runner.detections.slice(0, 4).map((det) => (
                    <div 
                      key={det.id} 
                      className="aspect-square bg-black rounded-3xl overflow-hidden border border-white/5 relative group/img cursor-zoom-in group"
                      onClick={() => setSelectedImage(det.photo.url)}
                    >
                      <img 
                        src={det.photo.url} 
                        alt="Runner Sighting" 
                        className="w-full h-full object-cover grayscale group-hover/img:grayscale-0 transition-all duration-700 scale-110 group-hover/img:scale-100" 
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                         <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center scale-75 group-hover/img:scale-100 transition-transform">
                            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"/></svg>
                         </div>
                      </div>
                    </div>
                  ))}
                  {/* Placeholder if few photos */}
                  {Array.from({ length: Math.max(0, 4 - runner.detections.length) }).map((_, i) => (
                    <div key={i} className="aspect-square bg-zinc-800/20 rounded-3xl border border-dashed border-zinc-800 flex items-center justify-center">
                       <svg className="w-6 h-6 text-zinc-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    </div>
                  ))}
                </div>

                <button className="w-full py-4 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-500 hover:text-white rounded-2xl text-[10px] font-black transition-all border border-zinc-800 uppercase tracking-[0.2em]">
                  View Full History
                </button>
              </div>
            </div>
          ))}
        </div>

        {runners?.length === 0 && (
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-[3rem] p-20 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-24 h-24 bg-zinc-800 rounded-3xl flex items-center justify-center mb-4">
              <svg className="w-12 h-12 text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            </div>
            <h2 className="text-3xl font-black uppercase">Your library is empty</h2>
            <p className="text-zinc-500 max-w-sm">No runners have been identified yet. Use the scanner to start populating your library.</p>
            <Link href="/" className="px-8 py-4 bg-purple-600 hover:bg-purple-500 rounded-2xl font-black transition-all shadow-xl shadow-purple-900/20">
              GO TO SCANNER
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
