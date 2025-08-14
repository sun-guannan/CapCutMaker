import os
import re
import pyJianYingDraft as draft
import shutil
from util import zip_draft, is_windows_path
from oss import upload_to_oss
from typing import Dict, Literal
from draft_cache import DRAFT_CACHE
from save_task_cache import DRAFT_TASKS, get_task_status, update_tasks_cache, update_task_field, increment_task_field, update_task_fields, create_task
from downloader import download_audio, download_file, download_image, download_video
from concurrent.futures import ThreadPoolExecutor, as_completed
import imageio.v2 as imageio
import subprocess
import json
from get_duration_impl import get_video_duration
import uuid
import threading
from collections import OrderedDict
import time
import requests # Import requests for making HTTP calls
import logging
# 导入配置
from settings import IS_CAPCUT_ENV, IS_UPLOAD_DRAFT

# --- 获取你的 Logger 实例 ---
# 这里的名称必须和你在 app.py 中配置的 logger 名称一致
logger = logging.getLogger('flask_video_generator') 

# 定义任务状态枚举类型
TaskStatus = Literal["initialized", "processing", "completed", "failed", "not_found"]

def build_asset_path(draft_folder: str, draft_id: str, asset_type: str, material_name: str) -> str:
    """
    构建资源文件路径
    :param draft_folder: 草稿文件夹路径
    :param draft_id: 草稿ID
    :param asset_type: 资源类型（audio, image, video）
    :param material_name: 素材名称
    :return: 构建好的路径
    """
    if is_windows_path(draft_folder):
        # Windows路径处理
        if os.name == 'nt': # 'nt' for Windows
            draft_real_path = os.path.join(draft_folder, draft_id, "assets", asset_type, material_name)
        else:
            windows_drive, windows_path = re.match(r'([a-zA-Z]:)(.*)', draft_folder).groups()
            parts = [p for p in windows_path.split('\\') if p]
            draft_real_path = os.path.join(windows_drive, *parts, draft_id, "assets", asset_type, material_name)
            # 规范化路径（确保分隔符一致）
            draft_real_path = draft_real_path.replace('/', '\\')
    else:
        # macOS/Linux路径处理
        draft_real_path = os.path.join(draft_folder, draft_id, "assets", asset_type, material_name)
    return draft_real_path

def save_draft_background(draft_id, draft_folder, task_id):
    """后台保存草稿到OSS"""
    try:
        # 从全局缓存中获取草稿信息
        if draft_id not in DRAFT_CACHE:
            task_status = {
                "status": "failed",
                "message": f"草稿 {draft_id} 不存在于缓存中",
                "progress": 0,
                "completed_files": 0,
                "total_files": 0,
                "draft_url": ""
            }
            update_tasks_cache(task_id, task_status)  # 使用新的缓存管理函数
            logger.error(f"草稿 {draft_id} 不存在于缓存中，任务 {task_id} 失败。")
            return
            
        script = DRAFT_CACHE[draft_id]
        logger.info(f"成功从缓存获取草稿 {draft_id}。")
        
        # 更新任务状态为处理中
        task_status = {
            "status": "processing",
            "message": "正在准备草稿文件",
            "progress": 0,
            "completed_files": 0,
            "total_files": 0,
            "draft_url": ""
        }
        update_tasks_cache(task_id, task_status)  # 使用新的缓存管理函数
        logger.info(f"任务 {task_id} 状态更新为 'processing'：正在准备草稿文件。")
        
        # 删除可能已存在的draft_id文件夹
        if os.path.exists(draft_id):
            logger.warning(f"删除已存在的草稿文件夹 (当前工作目录): {draft_id}")
            shutil.rmtree(draft_id)

        logger.info(f"开始保存草稿: {draft_id}")
        # 保存草稿
        current_dir = os.path.dirname(os.path.abspath(__file__))
        draft_folder_for_duplicate = draft.Draft_folder(current_dir)
        # 根据配置选择不同的模板目录
        template_dir = "template" if IS_CAPCUT_ENV else "template_jianying"
        draft_folder_for_duplicate.duplicate_as_template(template_dir, draft_id)
        
        # 更新任务状态
        update_task_field(task_id, "message", "正在更新媒体文件元数据")
        update_task_field(task_id, "progress", 5)
        logger.info(f"任务 {task_id} 进度5%：正在更新媒体文件元数据。")
        
        # 调用公共方法更新媒体文件元数据
        update_media_metadata(script, task_id)
        
        # 收集下载任务
        download_tasks = []
        
        # 收集音频下载任务
        audios = script.materials.audios
        if audios:
            for audio in audios:
                remote_url = audio.remote_url
                material_name = audio.material_name
                # 使用辅助函数构建路径
                if draft_folder:
                    audio.replace_path = build_asset_path(draft_folder, draft_id, "audio", material_name)
                if not remote_url:
                    logger.warning(f"音频文件 {material_name} 没有 remote_url，跳过下载。")
                    continue
                
                # 添加音频下载任务
                download_tasks.append({
                    'type': 'audio',
                    'func': download_file,
                    'args': (remote_url, os.path.join(current_dir, f"{draft_id}/assets/audio/{material_name}")),
                    'material': audio
                })
        
        # 收集视频和图片下载任务
        videos = script.materials.videos
        if videos:
            for video in videos:
                remote_url = video.remote_url
                material_name = video.material_name
                
                if video.type == 'photo':
                    # 使用辅助函数构建路径
                    if draft_folder:
                        video.replace_path = build_asset_path(draft_folder, draft_id, "image", material_name)
                    if not remote_url:
                        logger.warning(f"图片文件 {material_name} 没有 remote_url，跳过下载。")
                        continue
                    
                    # 添加图片下载任务
                    download_tasks.append({
                        'type': 'image',
                        'func': download_file,
                        'args': (remote_url, os.path.join(current_dir, f"{draft_id}/assets/image/{material_name}")),
                        'material': video
                    })
                
                elif video.type == 'video':
                    # 使用辅助函数构建路径
                    if draft_folder:
                        video.replace_path = build_asset_path(draft_folder, draft_id, "video", material_name)
                    if not remote_url:
                        logger.warning(f"视频文件 {material_name} 没有 remote_url，跳过下载。")
                        continue
                    
                    # 添加视频下载任务
                    download_tasks.append({
                        'type': 'video',
                        'func': download_file,
                        'args': (remote_url, os.path.join(current_dir, f"{draft_id}/assets/video/{material_name}")),
                        'material': video
                    })

        update_task_field(task_id, "message", f"共收集到{len(download_tasks)}个下载任务")
        update_task_field(task_id, "progress", 10)
        logger.info(f"任务 {task_id} 进度10%：共收集到 {len(download_tasks)} 个下载任务。")

        # 并发执行所有下载任务
        downloaded_paths = []
        completed_files = 0
        if download_tasks:
            logger.info(f"开始并发下载 {len(download_tasks)} 个文件...")
            
            # 使用线程池并发下载，最大并发数为16
            with ThreadPoolExecutor(max_workers=16) as executor:
                # 提交所有下载任务
                future_to_task = {
                    executor.submit(task['func'], *task['args']): task 
                    for task in download_tasks
                }
                
                # 等待所有任务完成
                for future in as_completed(future_to_task):
                    task = future_to_task[future]
                    try:
                        local_path = future.result()
                        downloaded_paths.append(local_path)
                        
                        # 更新任务状态 - 只更新已完成文件数
                        completed_files += 1
                        update_task_field(task_id, "completed_files", completed_files)
                        task_status = get_task_status(task_id)
                        completed = task_status["completed_files"]
                        total = len(download_tasks)
                        update_task_field(task_id, "total_files", total)
                        # 下载部分占总进度的60%
                        download_progress = 10 + int((completed / total) * 60)
                        update_task_field(task_id, "progress", download_progress)
                        update_task_field(task_id, "message", f"已下载 {completed}/{total} 个文件")
                        
                        logger.info(f"任务 {task_id}：成功下载 {task['type']} 文件，进度 {download_progress}。")
                    except Exception as e:
                        logger.error(f"任务 {task_id}：下载 {task['type']} 文件, 失败: {str(e)}", exc_info=True)
                        # 继续处理其他文件，不中断整个流程
            
            logger.info(f"任务 {task_id}：并发下载完成，共下载 {len(downloaded_paths)} 个文件。")
        
        # 更新任务状态 - 开始保存草稿信息
        update_task_field(task_id, "progress", 70)
        update_task_field(task_id, "message", "正在保存草稿信息")
        logger.info(f"任务 {task_id} 进度70%：正在保存草稿信息。")
        
        script.dump(os.path.join(current_dir, f"{draft_id}/draft_info.json"))
        logger.info(f"草稿信息已保存到 {draft_id}/draft_info.json。")

        draft_url = ""
        # 仅在 IS_UPLOAD_DRAFT 为 True 时上传草稿信息
        if IS_UPLOAD_DRAFT:
            # 更新任务状态 - 开始压缩草稿
            update_task_field(task_id, "progress", 80)
            update_task_field(task_id, "message", "正在压缩草稿文件")
            logger.info(f"任务 {task_id} 进度80%：正在压缩草稿文件。")
            
            # 压缩整个草稿目录
            zip_path = zip_draft(draft_id)
            logger.info(f"草稿目录 {draft_id} 已压缩为 {zip_path}。")
            
            # 更新任务状态 - 开始上传到OSS
            update_task_field(task_id, "progress", 90)
            update_task_field(task_id, "message", "正在上传到云存储")
            logger.info(f"任务 {task_id} 进度90%：正在上传到云存储。")
            
            # 上传到OSS
            draft_url = upload_to_oss(zip_path)
            logger.info(f"草稿压缩包已上传到 OSS，URL: {draft_url}")
            update_task_field(task_id, "draft_url", draft_url)

            # 清理临时文件
            if os.path.exists(os.path.join(current_dir, draft_id)):
                shutil.rmtree(os.path.join(current_dir, draft_id))
                logger.info(f"已清理临时草稿文件夹: {draft_id}")

    
        # 更新任务状态 - 完成
        update_task_field(task_id, "status", "completed")
        update_task_field(task_id, "progress", 100)
        update_task_field(task_id, "message", "草稿制作完成")
        logger.info(f"任务 {task_id} 已完成，草稿URL: {draft_url}")
        return draft_url

    except Exception as e:
        # 更新任务状态 - 失败
        update_task_fields(task_id, 
                          status="failed",
                          message=f"保存草稿失败: {str(e)}")
        logger.error(f"保存草稿 {draft_id} 任务 {task_id} 失败: {str(e)}", exc_info=True)
        return ""

def query_task_status(task_id: str):
    return get_task_status(task_id)

def save_draft_impl(draft_id: str, draft_folder: str = None) -> Dict[str, str]:
    """启动保存草稿的后台任务"""
    logger.info(f"接收到保存草稿请求：draft_id={draft_id}, draft_folder={draft_folder}")
    try:
        # 生成唯一的任务ID
        task_id = draft_id
        create_task(task_id)
        logger.info(f"任务 {task_id} 已创建。")
        
        # 改为同步执行
        return {
            "success": True,
            "draft_url": save_draft_background(draft_id, draft_folder, task_id)
            }

        # # 启动后台线程执行任务
        # thread = threading.Thread(
        #     target=save_draft_background,
        #     args=(draft_id, draft_folder, task_id)
        # )
        # thread.start()
        
    except Exception as e:
        logger.error(f"启动保存草稿任务 {draft_id} 失败: {str(e)}", exc_info=True)
        return {
            "success": False,
            "error": str(e)
        }

def update_media_metadata(script, task_id=None):
    """
    更新脚本中所有媒体文件的元数据（时长、宽高等）
    
    :param script: 草稿脚本对象
    :param task_id: 可选的任务ID，用于更新任务状态
    :return: None
    """
    # 处理音频文件元数据
    audios = script.materials.audios
    if not audios:
        logger.info("草稿中没有找到音频文件。")
    else:
        for audio in audios:
            remote_url = audio.remote_url
            material_name = audio.material_name
            if not remote_url:
                logger.warning(f"警告：音频文件 {material_name} 没有 remote_url，已跳过。")
                continue
            
            try:
                video_command = [
                    'ffprobe',
                    '-v', 'error',
                    '-select_streams', 'v:0',
                    '-show_entries', 'stream=codec_type',
                    '-of', 'json',
                    remote_url
                ]
                video_result = subprocess.check_output(video_command, stderr=subprocess.STDOUT)
                video_result_str = video_result.decode('utf-8')
                # 查找JSON开始位置（第一个'{'）
                video_json_start = video_result_str.find('{')
                if video_json_start != -1:
                    video_json_str = video_result_str[video_json_start:]
                    video_info = json.loads(video_json_str)
                    if 'streams' in video_info and len(video_info['streams']) > 0:
                        logger.warning(f"警告：音频文件 {material_name} 包含视频轨道，已跳过其元数据更新。")
                        continue
            except Exception as e:
                logger.error(f"检查音频 {material_name} 是否包含视频流时发生错误: {str(e)}", exc_info=True)

            # 获取音频时长并设置
            try:
                duration_result = get_video_duration(remote_url)
                if duration_result["success"]:
                    if task_id:
                        update_task_field(task_id, "message", f"正在处理音频元数据: {material_name}")
                    # 将秒转换为微秒
                    audio.duration = int(duration_result["output"] * 1000000)
                    logger.info(f"成功获取音频 {material_name} 时长: {duration_result['output']:.2f} 秒 ({audio.duration} 微秒)。")
                    
                    # 更新使用该音频素材的所有片段的timerange
                    for track_name, track in script.tracks.items():
                        if track.track_type == draft.Track_type.audio:
                            for segment in track.segments:
                                if isinstance(segment, draft.Audio_segment) and segment.material_id == audio.material_id:
                                    # 获取当前设置
                                    current_target = segment.target_timerange
                                    current_source = segment.source_timerange
                                    speed = segment.speed.speed
                                    
                                    # 如果source_timerange的结束时间超过了新的音频时长，则调整它
                                    if current_source.end > audio.duration or current_source.end <= 0:
                                        # 调整source_timerange以适应新的音频时长
                                        new_source_duration = audio.duration - current_source.start
                                        if new_source_duration <= 0:
                                            logger.warning(f"警告：音频片段 {segment.segment_id} 的起始时间 {current_source.start} 超出了音频时长 {audio.duration}，将跳过此片段。")
                                            continue
                                            
                                        # 更新source_timerange
                                        segment.source_timerange = draft.Timerange(current_source.start, new_source_duration)
                                        
                                        # 根据新的source_timerange和speed更新target_timerange
                                        new_target_duration = int(new_source_duration / speed)
                                        segment.target_timerange = draft.Timerange(current_target.start, new_target_duration)
                                        
                                        logger.info(f"已调整音频片段 {segment.segment_id} 的timerange以适应新的音频时长。")
                else:
                    logger.warning(f"警告：无法获取音频 {material_name} 的时长: {duration_result['error']}。")
            except Exception as e:
                logger.error(f"获取音频 {material_name} 时长时发生错误: {str(e)}", exc_info=True)
    
    # 处理视频和图片文件元数据
    videos = script.materials.videos
    if not videos:
        logger.info("草稿中没有找到视频或图片文件。")
    else:
        for video in videos:
            remote_url = video.remote_url
            material_name = video.material_name
            if not remote_url:
                logger.warning(f"警告：媒体文件 {material_name} 没有 remote_url，已跳过。")
                continue
                
            if video.type == 'photo':
                # 使用imageio获取图片宽高并设置
                try:
                    if task_id:
                        update_task_field(task_id, "message", f"正在处理图片元数据: {material_name}")
                    img = imageio.imread(remote_url)
                    video.height, video.width = img.shape[:2]
                    logger.info(f"成功设置图片 {material_name} 宽高: {video.width}x{video.height}。")
                except Exception as e:
                    logger.error(f"设置图片 {material_name} 宽高失败: {str(e)}，使用默认值 1920x1080。", exc_info=True)
                    video.width = 1920
                    video.height = 1080
            
            elif video.type == 'video':
                # 获取视频时长和宽高信息
                try:
                    if task_id:
                        update_task_field(task_id, "message", f"正在处理视频元数据: {material_name}")
                    # 使用ffprobe获取视频信息
                    command = [
                        'ffprobe',
                        '-v', 'error',
                        '-select_streams', 'v:0',  # 选择第一个视频流
                        '-show_entries', 'stream=width,height,duration',
                        '-show_entries', 'format=duration',
                        '-of', 'json',
                        remote_url
                    ]
                    result = subprocess.check_output(command, stderr=subprocess.STDOUT)
                    result_str = result.decode('utf-8')
                    # 查找JSON开始位置（第一个'{'）
                    json_start = result_str.find('{')
                    if json_start != -1:
                        json_str = result_str[json_start:]
                        info = json.loads(json_str)
                        
                        if 'streams' in info and len(info['streams']) > 0:
                            stream = info['streams'][0]
                            # 设置宽高
                            video.width = int(stream.get('width', 0))
                            video.height = int(stream.get('height', 0))
                            logger.info(f"成功设置视频 {material_name} 宽高: {video.width}x{video.height}。")
                            
                            # 设置时长
                            # 优先使用流的duration，如果没有则使用格式的duration
                            duration = stream.get('duration') or info['format'].get('duration', '0')
                            video.duration = int(float(duration) * 1000000)  # 转换为微秒
                            logger.info(f"成功获取视频 {material_name} 时长: {float(duration):.2f} 秒 ({video.duration} 微秒)。")
                            
                            # 更新使用该视频素材的所有片段的timerange
                            for track_name, track in script.tracks.items():
                                if track.track_type == draft.Track_type.video:
                                    for segment in track.segments:
                                        if isinstance(segment, draft.Video_segment) and segment.material_id == video.material_id:
                                            # 获取当前设置
                                            current_target = segment.target_timerange
                                            current_source = segment.source_timerange
                                            speed = segment.speed.speed

                                            # 如果source_timerange的结束时间超过了新的音频时长，则调整它
                                            if current_source.end > video.duration or current_source.end <= 0:
                                                # 调整source_timerange以适应新的视频时长
                                                new_source_duration = video.duration - current_source.start
                                                if new_source_duration <= 0:
                                                    logger.warning(f"警告：视频片段 {segment.segment_id} 的起始时间 {current_source.start} 超出了视频时长 {video.duration}，将跳过此片段。")
                                                    continue
                                                    
                                                # 更新source_timerange
                                                segment.source_timerange = draft.Timerange(current_source.start, new_source_duration)
                                                
                                                # 根据新的source_timerange和speed更新target_timerange
                                                new_target_duration = int(new_source_duration / speed)
                                                segment.target_timerange = draft.Timerange(current_target.start, new_target_duration)
                                                
                                                logger.info(f"已调整视频片段 {segment.segment_id} 的timerange以适应新的视频时长。")
                        else:
                            logger.warning(f"警告：无法获取视频 {material_name} 的流信息。")
                            # 设置默认值
                            video.width = 1920
                            video.height = 1080
                    else:
                        logger.warning(f"警告：无法在ffprobe输出中找到JSON数据。")
                        # 设置默认值
                        video.width = 1920
                        video.height = 1080
                except Exception as e:
                    logger.error(f"获取视频 {material_name} 信息时发生错误: {str(e)}，使用默认值 1920x1080。", exc_info=True)
                    # 设置默认值
                    video.width = 1920
                    video.height = 1080
                    
                    # 尝试单独获取时长
                    try:
                        duration_result = get_video_duration(remote_url)
                        if duration_result["success"]:
                            # 将秒转换为微秒
                            video.duration = int(duration_result["output"] * 1000000)
                            logger.info(f"成功获取视频 {material_name} 时长: {duration_result['output']:.2f} 秒 ({video.duration} 微秒)。")
                        else:
                            logger.warning(f"警告：无法获取视频 {material_name} 的时长: {duration_result['error']}。")
                    except Exception as e2:
                        logger.error(f"获取视频 {material_name} 时长时发生错误: {str(e2)}。", exc_info=True)

    # 在更新完所有片段的timerange后，检查每个轨道中的片段是否有时间范围冲突，并删除冲突的后一个片段
    logger.info("检查轨道片段时间范围冲突...")
    for track_name, track in script.tracks.items():
        # 使用集合记录需要删除的片段索引
        to_remove = set()
        
        # 检查所有片段之间的冲突
        for i in range(len(track.segments)):
            # 如果当前片段已经被标记为删除，则跳过
            if i in to_remove:
                continue
                
            for j in range(len(track.segments)):
                # 跳过自身比较和已标记为删除的片段
                if i == j or j in to_remove:
                    continue
                    
                # 检查是否有冲突
                if track.segments[i].overlaps(track.segments[j]):
                    # 总是保留索引较小的片段（先添加的片段）
                    later_index = max(i, j)
                    logger.warning(f"轨道 {track_name} 中的片段 {track.segments[min(i, j)].segment_id} 和 {track.segments[later_index].segment_id} 时间范围冲突，删除后一个片段")
                    to_remove.add(later_index)
        
        # 从后向前删除标记的片段，避免索引变化问题
        for index in sorted(to_remove, reverse=True):
            track.segments.pop(index)

    # 在更新完所有片段的timerange后，重新计算脚本的总时长
    max_duration = 0
    for track_name, track in script.tracks.items():
        for segment in track.segments:
            max_duration = max(max_duration, segment.end)
    script.duration = max_duration
    logger.info(f"更新脚本总时长为: {script.duration} 微秒。")
    
    # 处理所有轨道中待添加的关键帧
    logger.info("处理待添加的关键帧...")
    for track_name, track in script.tracks.items():
        if hasattr(track, 'pending_keyframes') and track.pending_keyframes:
            logger.info(f"处理轨道 {track_name} 中的 {len(track.pending_keyframes)} 个待添加关键帧...")
            track.process_pending_keyframes()
            logger.info(f"轨道 {track_name} 中的待添加关键帧已处理完成。")

def query_script_impl(draft_id: str, force_update: bool = True):
    """
    查询草稿脚本对象，可选择是否强制刷新媒体元数据
    
    :param draft_id: 草稿ID
    :param force_update: 是否强制刷新媒体元数据，默认为True
    :return: 脚本对象
    """
    # 从全局缓存中获取草稿信息
    if draft_id not in DRAFT_CACHE:
        logger.warning(f"草稿 {draft_id} 不存在于缓存中。")
        return None
        
    script = DRAFT_CACHE[draft_id]
    logger.info(f"从缓存中获取草稿 {draft_id}。")
    
    # 如果force_update为True，则强制刷新媒体元数据
    if force_update:
        logger.info(f"强制刷新草稿 {draft_id} 的媒体元数据。")
        update_media_metadata(script)
    
    # 返回脚本对象
    return script

def download_script(draft_id: str, draft_folder: str = None, script_data: Dict = None) -> Dict[str, str]:
    """
    Downloads the draft script and its associated media assets.

    This function fetches the script object from a remote API,
    then iterates through its materials (audios, videos, images)
    to download them to the specified draft folder. It also updates
    task status and progress throughout the process.

    :param draft_id: The ID of the draft to download.
    :param draft_folder: The base folder where the draft's assets will be stored.
                         If None, assets will be stored directly under a folder named
                         after the draft_id in the current working directory.
    :return: A dictionary indicating success and, if successful, the URL where the draft
             would eventually be saved (though this function primarily focuses on download).
             If failed, it returns an error message.
    """

    logger.info(f"开始下载草稿: {draft_id} 到文件夹: {draft_folder}")
    # 把模版复制到目标目录下
    template_path = os.path.join("./", 'template') if IS_CAPCUT_ENV else os.path.join("./", 'template_jianying')
    new_draft_path = os.path.join(draft_folder, draft_id)
    if os.path.exists(new_draft_path):
        logger.warning(f"删除已存在的草稿目标文件夹: {new_draft_path}")
        shutil.rmtree(new_draft_path)

    # 复制草稿文件夹
    shutil.copytree(template_path, new_draft_path)
    
    try:
        # 1. Fetch the script from the remote endpoint
        if script_data is None:
            query_url = "https://cut-jianying-vdvswivepm.cn-hongkong.fcapp.run/query_script"
            headers = {"Content-Type": "application/json"}
            payload = {"draft_id": draft_id}

            logger.info(f"尝试从 {query_url} 获取草稿 ID: {draft_id} 的脚本。")
            response = requests.post(query_url, headers=headers, json=payload)
            response.raise_for_status()  # Raise an exception for HTTP errors (4xx or 5xx)
            
            script_data = json.loads(response.json().get('output'))
            logger.info(f"成功获取草稿 {draft_id} 的脚本数据。")
        else:
            logger.info(f"使用传入的 script_data，跳过远程获取。")

        # 收集下载任务
        download_tasks = []
        
        # 收集音频下载任务
        audios = script_data.get('materials',{}).get('audios',[])
        if audios:
            for audio in audios:
                remote_url = audio['remote_url']
                material_name = audio['name']
                # 使用辅助函数构建路径
                if draft_folder:
                    audio['path']=build_asset_path(draft_folder, draft_id, "audio", material_name)
                    logger.debug(f"音频 {material_name} 的本地路径: {audio['path']}")
                if not remote_url:
                    logger.warning(f"音频文件 {material_name} 没有 remote_url，跳过下载。")
                    continue
                
                # 添加音频下载任务
                download_tasks.append({
                    'type': 'audio',
                    'func': download_file,
                    'args': (remote_url, audio['path']),
                    'material': audio
                })
        
        # 收集视频和图片下载任务
        videos = script_data['materials']['videos']
        if videos:
            for video in videos:
                remote_url = video['remote_url']
                material_name = video['material_name']
                
                if video['type'] == 'photo':
                    # 使用辅助函数构建路径
                    if draft_folder:
                        video['path'] = build_asset_path(draft_folder, draft_id, "image", material_name)
                    if not remote_url:
                        logger.warning(f"图片文件 {material_name} 没有 remote_url，跳过下载。")
                        continue
                    
                    # 添加图片下载任务
                    download_tasks.append({
                        'type': 'image',
                        'func': download_file,
                        'args': (remote_url, video['path']),
                        'material': video
                    })
                
                elif video['type'] == 'video':
                    # 使用辅助函数构建路径
                    if draft_folder:
                        video['path'] = build_asset_path(draft_folder, draft_id, "video", material_name)
                    if not remote_url:
                        logger.warning(f"视频文件 {material_name} 没有 remote_url，跳过下载。")
                        continue
                    
                    # 添加视频下载任务
                    download_tasks.append({
                        'type': 'video',
                        'func': download_file,
                        'args': (remote_url, video['path']),
                        'material': video
                    })

        # 并发执行所有下载任务
        downloaded_paths = []
        completed_files = 0
        if download_tasks:
            logger.info(f"开始并发下载 {len(download_tasks)} 个文件...")
            
            # 使用线程池并发下载，最大并发数为16
            with ThreadPoolExecutor(max_workers=16) as executor:
                # 提交所有下载任务
                future_to_task = {
                    executor.submit(task['func'], *task['args']): task 
                    for task in download_tasks
                }
                
                # 等待所有任务完成
                for future in as_completed(future_to_task):
                    task = future_to_task[future]
                    try:
                        local_path = future.result()
                        downloaded_paths.append(local_path)
                        
                        # 更新任务状态 - 只更新已完成文件数
                        completed_files += 1
                        logger.info(f"已下载 {completed_files}/{len(download_tasks)} 个文件。")
                    except Exception as e:
                        logger.error(f"下载 {task['type']} 文件 {task['args'][0]} 失败: {str(e)}", exc_info=True)
                        logger.error("下载失败。")
                        # 继续处理其他文件，不中断整个流程
            
            logger.info(f"并发下载完成，共下载 {len(downloaded_paths)} 个文件。")
        
        """将草稿文件内容写入文件"""
        with open(f"{draft_folder}/{draft_id}/draft_info.json", "w", encoding="utf-8") as f:
            f.write(json.dumps(script_data))
        logger.info(f"草稿已保存。")

        # No draft_url for download, but return success
        return {"success": True, "message": f"Draft {draft_id} and its assets downloaded successfully"}

    except requests.exceptions.RequestException as e:
        logger.error(f"API 请求失败: {e}", exc_info=True)
        return {"success": False, "error": f"Failed to fetch script from API: {str(e)}"}
    except Exception as e:
        logger.error(f"下载过程中发生意外错误: {e}", exc_info=True)
        return {"success": False, "error": f"An unexpected error occurred: {str(e)}"}

if __name__ == "__main__":
    print('hello')
    download_script("dfd_cat_1751012163_a7e8c315",'/Users/sunguannan/Movies/JianyingPro/User Data/Projects/com.lveditor.draft')