# Bình chọn Tây Nam — phiên bản Internet

Ứng dụng bình chọn trực tiếp giữ giao diện/bố cục của dự án gốc:

- Trang điện thoại: `/vote` — chọn **Đánh** hoặc **Không đánh**.
- Màn hình trình chiếu: `/screen` — QR tự lấy địa chỉ Internet của Render, số phiếu và tỷ lệ cập nhật trực tiếp.
- Trang quản trị: `/admin` — đăng nhập bằng mật khẩu riêng.
- Điều khiển trên màn hình: **O** khóa/mở bình chọn, **H** hé lộ/quay lại lịch sử, **R** bấm hai lần để xóa phiếu, **F** toàn màn hình.
- Mỗi trình duyệt/thiết bị có một mã bình chọn lưu trong localStorage; có thể đổi lựa chọn khi cuộc bình chọn đang mở.
- Quản trị dùng cookie HttpOnly, chữ ký HMAC, hết hạn sau 12 giờ; giới hạn thử mật khẩu sai.
- Khi có `DATABASE_URL`, dữ liệu được lưu PostgreSQL; khi chạy local không có DB, dữ liệu được lưu ở `data/votes.json`.

## Cách chạy thử trên máy tính

1. Cài Node.js LTS (Node 20 trở lên): https://nodejs.org
2. Giải nén thư mục dự án.
3. Đổi tên `.env.example` thành `.env` và đặt `ADMIN_PASSWORD` thành mật khẩu của bạn.
4. Windows: nhấp đúp `CHAY-WINDOWS.bat`. macOS: nhấp đúp `CHAY-MAC.command` (có thể cần cấp quyền chạy).
5. Mở `http://localhost:3000/admin`, đăng nhập; sau đó màn hình trình chiếu mở tại `http://localhost:3000/screen`.

Hoặc mở terminal ở thư mục dự án và chạy:

```bash
npm install
npm start
```

## Triển khai Internet lên Render (khuyến nghị qua Blueprint)

### Cách nhanh: Blueprint

1. Đưa **toàn bộ nội dung bên trong thư mục này** lên một GitHub repository mới hoặc repository riêng cho ứng dụng. File `render.yaml` phải nằm ở thư mục gốc repository.
2. Mở https://dashboard.render.com/ → **New** → **Blueprint**.
3. Kết nối repository vừa cập nhật và chọn branch `main` (hoặc branch chứa file).
4. Render đọc `render.yaml` và hiển thị các tài nguyên trước khi tạo. Blueprint này tạo:
   - Web Service `tay-nam-vote-online` (Free).
   - PostgreSQL `tay-nam-vote-db` gói `0.1c-256mb` (gói trả phí).
5. Khi Render yêu cầu `ADMIN_PASSWORD`, nhập mật khẩu mạnh, riêng tư (nên từ 12 ký tự trở lên). Không đưa mật khẩu vào GitHub.
6. Xác nhận tạo Blueprint. Chờ Web Service báo **Live**.
7. Mở URL `onrender.com` trong trang Web Service. Vào `/admin` để đăng nhập, `/screen` để trình chiếu, `/vote` để thử bằng điện thoại/4G.

`PUBLIC_URL` được liên kết tự động với `RENDER_EXTERNAL_URL`, `DATABASE_URL` tự liên kết với PostgreSQL, và `SESSION_SECRET` do Render tự tạo.

### Chi phí và giới hạn cần biết

- Render Web Service Free có thể tự ngủ sau 15 phút không có truy cập và mất khoảng một phút để thức dậy. Trong lúc hoạt động, phiếu được lưu ở PostgreSQL, không lưu trên ổ đĩa tạm của web service.
- Blueprint dùng Render Postgres gói `0.1c-256mb` trả phí (bảng giá Render hiện hiển thị khoảng **6 USD/tháng**). Hãy kiểm tra giá cuối cùng ở màn hình xác nhận trước khi tạo.
- Không đổi database sang Free nếu bạn cần giữ dữ liệu lâu dài: Postgres Free của Render hết hạn sau 30 ngày và bị xóa sau thời gian gia hạn nếu không nâng cấp.
- Nếu muốn web service không ngủ, có thể chọn gói web trả phí thay cho Free; kiểm tra bảng giá Render trước khi xác nhận.

### Nếu đã có Web Service Render và muốn giữ dịch vụ đó

Không cần tạo Blueprint mới. Có thể cập nhật source ở GitHub đang nối với dịch vụ hiện tại rồi cấu hình thủ công:

1. Chép toàn bộ nội dung dự án vào đúng thư mục gốc mà dịch vụ Render đang dùng; push commit lên đúng branch.
2. Render → Web Service hiện tại → Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Health Check Path: `/health`
3. Tạo một Render PostgreSQL ở cùng region với Web Service. Chọn gói trả phí nếu cần dữ liệu bền vững; sao chép **Internal Database URL**.
4. Web Service → Environment, thêm:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = Internal Database URL vừa sao chép
   - `ADMIN_PASSWORD` = mật khẩu quản trị mạnh, riêng tư
   - `SESSION_SECRET` = chuỗi ngẫu nhiên dài (ít nhất 32 ký tự)
   - `PUBLIC_URL` = URL `https://...onrender.com` của Web Service (nếu không đặt, ứng dụng tự lấy `RENDER_EXTERNAL_URL`).
5. Save, deploy lại và kiểm tra `/health` trả về `{"ok":true,"storage":"postgres"}`.

**Lưu ý:** Không deploy chế độ production nếu chưa có `DATABASE_URL`; máy chủ chủ động dừng để tránh âm thầm lưu phiếu vào ổ đĩa tạm có thể bị xóa. `render.yaml` là Blueprint riêng; nếu chỉ push file vào repository đã có Web Service, các tài nguyên Blueprint không tự được tạo cho đến khi bạn tạo/sync Blueprint.

## Đường dẫn sau khi triển khai

Thay `TEN-DICH-VU` bằng tên miền Render của bạn:

- `https://TEN-DICH-VU.onrender.com/admin`
- `https://TEN-DICH-VU.onrender.com/screen`
- `https://TEN-DICH-VU.onrender.com/vote`

QR trên `/screen` tự trỏ đến `/vote` cùng tên miền, vì vậy điện thoại dùng 4G hoặc Wi-Fi đều có thể truy cập.

## Dữ liệu và giới hạn

- Bản này khởi tạo bộ phiếu mới; **không tự nhập phiếu cũ** từ `votes.json` của phiên bản trước.
- Một phiếu được định danh theo mã trình duyệt. Người dùng có thể đổi lựa chọn khi mở bình chọn; xóa dữ liệu trình duyệt hoặc dùng trình duyệt khác sẽ tạo mã mới. Đây không phải hệ thống xác minh danh tính/ngăn gian lận cấp cao.
- SSE đẩy tổng số phiếu và trạng thái đến các màn hình đang mở. Hãy giữ một Web Service instance để tránh các kết nối SSE bị chia trên nhiều máy chủ.
- Nút xóa phiếu yêu cầu bấm hai lần trong 4 giây để tránh thao tác nhầm.

## Cấu trúc

```text
public/
  vote.html       Trang điện thoại bình chọn
  screen.html     Màn hình trình chiếu và QR
  admin.html      Đăng nhập quản trị
  theme.css       Giao diện dùng chung
  bg.js           Nền động
  qr.js           Thư viện tạo QR tại máy khách
server.js         API, SSE, xác thực quản trị, PostgreSQL/local JSON
render.yaml       Cấu hình Render Blueprint
.env.example      Mẫu cấu hình local
```
