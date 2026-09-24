using System;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal sealed class BridgeForm : Form
{
    private const int Port = 4175;
    private readonly Label status;

    internal BridgeForm()
    {
        Text = "DiskPilot 桌面助手";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(380, 130);
        MinimumSize = Size;

        var title = new Label { Text = "DiskPilot 桌面助手", Font = new Font("Microsoft YaHei UI", 12, FontStyle.Bold), AutoSize = true, Location = new Point(20, 20) };
        status = new Label { Text = "桌面连接已就绪", AutoSize = true, Location = new Point(20, 60) };
        Controls.Add(title);
        Controls.Add(status);
        Shown += delegate { new Thread(Listen) { IsBackground = true }.Start(); };
    }

    private void Listen()
    {
        var listener = new TcpListener(IPAddress.Loopback, Port);
        try { listener.Start(); }
        catch (SocketException)
        {
            BeginInvoke((Action)delegate { status.Text = "本机连接端口被占用，请关闭其他桌面助手"; });
            return;
        }
        try { while (!IsDisposed)
        {
            try
            {
                using (var client = listener.AcceptTcpClient())
                using (var stream = client.GetStream())
                {
                    using (var reader = new StreamReader(stream, Encoding.UTF8))
                    using (var writer = new StreamWriter(stream, new UTF8Encoding(false)) { AutoFlush = true })
                    {
                        if (reader.ReadLine() != "PICK") continue;
                        string selected = null;
                        Invoke((Action)delegate
                        {
                            bool wasTopMost = TopMost;
                            try
                            {
                                if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
                                TopMost = true;
                                Activate();
                                BringToFront();
                                using (var dialog = new FolderBrowserDialog())
                                {
                                    dialog.Description = "选择扫描文件夹";
                                    dialog.RootFolder = Environment.SpecialFolder.MyComputer;
                                    dialog.ShowNewFolderButton = false;
                                    if (dialog.ShowDialog(this) == DialogResult.OK) selected = dialog.SelectedPath;
                                }
                            }
                            finally
                            {
                                TopMost = wasTopMost;
                            }
                            status.Text = selected == null ? "已取消选择" : "已选择文件夹";
                        });
                        writer.WriteLine(selected == null ? "" : Convert.ToBase64String(Encoding.UTF8.GetBytes(selected)));
                    }
                }
            }
            catch (ObjectDisposedException) { break; }
            catch (InvalidOperationException) { break; }
            catch
            {
                if (IsDisposed) break;
                Thread.Sleep(500);
            }
        }}
        finally { listener.Stop(); }
    }
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new BridgeForm());
    }
}
