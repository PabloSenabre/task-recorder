// ============================================
// Task Recorder - Audio Recorder
// Captures microphone audio during task recording
// ============================================

export interface AudioChunk {
  data: Blob;
  timestamp: number;
  duration: number;
}

export interface AudioRecorderState {
  isRecording: boolean;
  hasPermission: boolean;
  error: string | null;
}

type AudioChunkCallback = (chunk: AudioChunk) => void;

class AudioRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime: number = 0;
  private chunkCallback: AudioChunkCallback | null = null;
  private chunkIntervalMs: number = 5000; // Send chunks every 5 seconds
  
  private state: AudioRecorderState = {
    isRecording: false,
    hasPermission: false,
    error: null
  };

  /**
   * Request microphone permission
   */
  async requestPermission(): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000 // Good quality for speech
        }
      });
      
      // Stop the test stream
      stream.getTracks().forEach(track => track.stop());
      
      this.state.hasPermission = true;
      this.state.error = null;
      console.log('[AudioRecorder] Permission granted');
      return true;
    } catch (error) {
      this.state.hasPermission = false;
      this.state.error = (error as Error).message;
      console.error('[AudioRecorder] Permission denied:', error);
      return false;
    }
  }

  /**
   * Start recording audio
   */
  async start(onChunk?: AudioChunkCallback): Promise<boolean> {
    if (this.state.isRecording) {
      console.warn('[AudioRecorder] Already recording');
      return true;
    }

    try {
      // Get microphone access
      this.stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000
        }
      });

      // Create MediaRecorder
      // Use webm/opus for good quality and small size
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') 
        ? 'audio/webm;codecs=opus' 
        : 'audio/webm';
      
      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      this.chunks = [];
      this.startTime = Date.now();
      this.chunkCallback = onChunk || null;

      // Handle data available
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.chunks.push(event.data);
          
          // If we have a callback, send the chunk
          if (this.chunkCallback) {
            const chunk: AudioChunk = {
              data: event.data,
              timestamp: Date.now(),
              duration: this.chunkIntervalMs
            };
            this.chunkCallback(chunk);
          }
        }
      };

      // Handle errors
      this.mediaRecorder.onerror = (event) => {
        console.error('[AudioRecorder] Error:', event);
        this.state.error = 'Recording error';
      };

      // Start recording with timeslice for regular chunks
      this.mediaRecorder.start(this.chunkIntervalMs);
      
      this.state.isRecording = true;
      this.state.hasPermission = true;
      this.state.error = null;
      
      console.log('[AudioRecorder] Recording started');
      return true;
    } catch (error) {
      this.state.error = (error as Error).message;
      console.error('[AudioRecorder] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop recording and return the complete audio blob
   */
  async stop(): Promise<Blob | null> {
    if (!this.state.isRecording || !this.mediaRecorder) {
      console.warn('[AudioRecorder] Not recording');
      return null;
    }

    return new Promise((resolve) => {
      if (!this.mediaRecorder) {
        resolve(null);
        return;
      }

      this.mediaRecorder.onstop = () => {
        // Combine all chunks into a single blob
        const mimeType = this.mediaRecorder?.mimeType || 'audio/webm';
        const completeBlob = new Blob(this.chunks, { type: mimeType });
        
        // Clean up
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
          this.stream = null;
        }
        
        this.state.isRecording = false;
        this.mediaRecorder = null;
        
        console.log('[AudioRecorder] Recording stopped, size:', completeBlob.size);
        resolve(completeBlob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * Get current state
   */
  getState(): AudioRecorderState {
    return { ...this.state };
  }

  /**
   * Get recording duration in ms
   */
  getDuration(): number {
    if (!this.state.isRecording) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Check if browser supports audio recording
   */
  static isSupported(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
}

// Singleton instance
export const audioRecorder = new AudioRecorder();

